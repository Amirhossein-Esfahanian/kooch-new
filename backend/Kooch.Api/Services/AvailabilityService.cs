using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class AvailabilityService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IAuditLogService auditLogService) : IAvailabilityService
{
    public async Task<PropertyInventoryResponse> GetPropertyInventoryAsync(
        int userId,
        UserRole role,
        int propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(from, to);
        await EnsureCanManagePropertyAsync(userId, role, propertyId, cancellationToken);

        return await BuildPropertyInventoryAsync(propertyId, from, to, cancellationToken);
    }

    public async Task<PropertyInventoryResponse> BulkUpdateInventoryAsync(
        int userId,
        UserRole role,
        int propertyId,
        BulkInventoryRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(request.StartDate, request.EndDate);
        await EnsureCanManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var roomTypes = await dbContext.RoomTypes
            .Where(roomType => roomType.PropertyId == propertyId &&
                               roomType.IsActive &&
                               (!request.RoomTypeId.HasValue || roomType.Id == request.RoomTypeId.Value))
            .ToListAsync(cancellationToken);

        if (request.RoomTypeId.HasValue && roomTypes.Count == 0)
        {
            throw new KeyNotFoundException("Room type not found.");
        }

        foreach (var roomType in roomTypes)
        {
            ValidateAvailableCount(roomType, request.AvailableCount);
        }

        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var existing = await dbContext.Availabilities
            .Where(availability => roomTypeIds.Contains(availability.RoomTypeId) &&
                                   availability.Date >= request.StartDate &&
                                   availability.Date <= request.EndDate)
            .ToDictionaryAsync(
                availability => (availability.RoomTypeId, availability.Date),
                cancellationToken);

        foreach (var roomType in roomTypes)
        {
            for (var date = request.StartDate; date <= request.EndDate; date = date.AddDays(1))
            {
                UpsertInventoryEntity(
                    roomType,
                    date,
                    request.AvailableCount,
                    existing.GetValueOrDefault((roomType.Id, date)));
            }
        }

        AddInventoryAudit(
            userId,
            propertyId,
            roomTypes.Count,
            request.StartDate,
            request.EndDate,
            request.AvailableCount,
            request.AvailableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available);
        await dbContext.SaveChangesAsync(cancellationToken);

        var monthStart = new DateOnly(request.StartDate.Year, request.StartDate.Month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);
        return await BuildPropertyInventoryAsync(propertyId, monthStart, monthEnd, cancellationToken);
    }

    public async Task<IReadOnlyList<InventoryDayResponse>> BulkUpdateInventoryCellsAsync(
        int userId,
        UserRole role,
        int propertyId,
        BulkInventoryCellsRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertyAsync(userId, role, propertyId, cancellationToken);
        if (request.Items.Count == 0)
        {
            throw new ArgumentException("At least one inventory cell is required.");
        }

        var roomTypeIds = request.Items.Select(item => item.RoomTypeId).Distinct().ToArray();
        var roomTypes = await dbContext.RoomTypes
            .Where(roomType => roomType.PropertyId == propertyId &&
                               roomType.IsActive &&
                               roomTypeIds.Contains(roomType.Id))
            .ToDictionaryAsync(roomType => roomType.Id, cancellationToken);

        if (roomTypes.Count != roomTypeIds.Length)
        {
            throw new KeyNotFoundException("One or more room types were not found.");
        }

        var effectiveCount = request.Status == AvailabilityStatus.Unavailable ? 0 : request.AvailableCount;
        foreach (var roomType in roomTypes.Values)
        {
            ValidateAvailableCount(roomType, effectiveCount);
        }

        var dates = request.Items.Select(item => item.Date).Distinct().ToArray();
        var existing = await dbContext.Availabilities
            .Where(availability => roomTypeIds.Contains(availability.RoomTypeId) &&
                                   dates.Contains(availability.Date))
            .ToDictionaryAsync(availability => (availability.RoomTypeId, availability.Date), cancellationToken);

        var updated = new List<Availability>();
        foreach (var item in request.Items.DistinctBy(item => (item.RoomTypeId, item.Date)))
        {
            var availability = UpsertInventoryEntity(
                roomTypes[item.RoomTypeId],
                item.Date,
                effectiveCount,
                existing.GetValueOrDefault((item.RoomTypeId, item.Date)),
                request.Status);
            updated.Add(availability);
        }

        var distinctItems = request.Items.DistinctBy(item => (item.RoomTypeId, item.Date)).ToList();
        AddInventoryAudit(
            userId,
            propertyId,
            roomTypeIds.Length,
            distinctItems.Min(item => item.Date),
            distinctItems.Max(item => item.Date),
            effectiveCount,
            request.Status);
        await dbContext.SaveChangesAsync(cancellationToken);
        var claimedCounts = await GetClaimedCountsAsync(roomTypeIds, dates.Min(), dates.Max(), cancellationToken);
        return updated
            .OrderBy(item => item.Date)
            .ThenBy(item => item.RoomTypeId)
            .Select(item => new InventoryDayResponse
            {
                AvailabilityId = item.Id,
                RoomTypeId = item.RoomTypeId,
                Date = item.Date,
                AvailableCount = Math.Max(0, item.AvailableCount - claimedCounts.GetValueOrDefault((item.RoomTypeId, item.Date))),
                Status = EffectiveStatus(item.Status, item.AvailableCount - claimedCounts.GetValueOrDefault((item.RoomTypeId, item.Date)))
            })
            .ToList();
    }

    public async Task<InventoryDayResponse> UpsertInventoryDayAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpsertInventoryRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var roomType = await dbContext.RoomTypes
            .SingleOrDefaultAsync(item => item.Id == request.RoomTypeId &&
                                          item.PropertyId == propertyId &&
                                          item.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        ValidateAvailableCount(roomType, request.AvailableCount);

        var availability = await dbContext.Availabilities
            .SingleOrDefaultAsync(item => item.RoomTypeId == roomType.Id && item.Date == request.Date, cancellationToken);

        availability = UpsertInventoryEntity(roomType, request.Date, request.AvailableCount, availability);
        AddInventoryAudit(
            userId,
            propertyId,
            1,
            request.Date,
            request.Date,
            request.AvailableCount,
            request.AvailableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available);
        await dbContext.SaveChangesAsync(cancellationToken);
        var claimedCount = (await GetClaimedCountsAsync(
            [roomType.Id],
            request.Date,
            request.Date,
            cancellationToken)).GetValueOrDefault((roomType.Id, request.Date));
        var effectiveCount = Math.Max(0, request.AvailableCount - claimedCount);

        return new InventoryDayResponse
        {
            AvailabilityId = availability?.Id,
            RoomTypeId = roomType.Id,
            Date = request.Date,
            AvailableCount = effectiveCount,
            Status = EffectiveStatus(
                request.AvailableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available,
                effectiveCount)
        };
    }

    public async Task<InventoryDayResponse> UpdateInventoryDayAsync(
        int userId,
        UserRole role,
        int availabilityId,
        int availableCount,
        CancellationToken cancellationToken = default)
    {
        var availability = await dbContext.Availabilities
            .Include(item => item.RoomType)
            .ThenInclude(roomType => roomType.Property)
            .SingleOrDefaultAsync(item => item.Id == availabilityId, cancellationToken)
            ?? throw new KeyNotFoundException("Availability row not found.");

        await EnsureCanManagePropertyAsync(userId, role, availability.RoomType.PropertyId, cancellationToken);
        ValidateAvailableCount(availability.RoomType, availableCount);

        availability.AvailableCount = availableCount;
        availability.Status = availableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available;
        availability.IsClosed = availableCount == 0;
        AddInventoryAudit(
            userId,
            availability.RoomType.PropertyId,
            1,
            availability.Date,
            availability.Date,
            availability.AvailableCount,
            availability.Status);
        await dbContext.SaveChangesAsync(cancellationToken);
        var claimedCount = (await GetClaimedCountsAsync(
            [availability.RoomTypeId],
            availability.Date,
            availability.Date,
            cancellationToken)).GetValueOrDefault((availability.RoomTypeId, availability.Date));
        var effectiveCount = Math.Max(0, availability.AvailableCount - claimedCount);

        return new InventoryDayResponse
        {
            AvailabilityId = availability.Id,
            RoomTypeId = availability.RoomTypeId,
            Date = availability.Date,
            AvailableCount = effectiveCount,
            Status = EffectiveStatus(availability.Status, effectiveCount)
        };
    }

    public async Task<IReadOnlyList<AvailabilityResponse>> GetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(from, to);
        await EnsureCanManageAsync(userId, role, roomTypeId, cancellationToken);

        var rows = await dbContext.Availabilities.AsNoTracking()
            .Where(availability => availability.RoomTypeId == roomTypeId &&
                                   availability.Date >= from &&
                                   availability.Date <= to)
            .OrderBy(availability => availability.Date)
            .ToListAsync(cancellationToken);
        var claimedCounts = await GetClaimedCountsAsync([roomTypeId], from, to, cancellationToken);
        return rows.Select(availability =>
            {
                var effectiveCount = Math.Max(
                    0,
                    availability.AvailableCount - claimedCounts.GetValueOrDefault((availability.RoomTypeId, availability.Date)));
                return new AvailabilityResponse
                {
                    Id = availability.Id,
                    RoomTypeId = availability.RoomTypeId,
                    Date = availability.Date,
                    Price = availability.Price,
                    OriginalPrice = availability.OriginalPrice,
                    AvailableCount = effectiveCount,
                    Status = EffectiveStatus(availability.Status, effectiveCount),
                    MinNightsOverride = availability.MinNightsOverride
                };
            })
            .ToList();
    }

    public async Task<IReadOnlyList<AvailabilityResponse>> SetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        SetAvailabilityRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(request.StartDate, request.EndDate);
        var roomType = await EnsureCanManageAsync(userId, role, roomTypeId, cancellationToken);
        ValidateAvailableCount(roomType, request.AvailableCount);

        var existing = await dbContext.Availabilities
            .Where(availability => availability.RoomTypeId == roomTypeId &&
                                   availability.Date >= request.StartDate &&
                                   availability.Date <= request.EndDate)
            .ToDictionaryAsync(availability => availability.Date, cancellationToken);

        for (var date = request.StartDate; date <= request.EndDate; date = date.AddDays(1))
        {
            if (!existing.TryGetValue(date, out var availability))
            {
                availability = new Availability
                {
                    RoomTypeId = roomTypeId,
                    Date = date
                };
                dbContext.Availabilities.Add(availability);
            }

            availability.Price = request.Price;
            availability.OriginalPrice = request.OriginalPrice;
            availability.AvailableCount = request.Status == AvailabilityStatus.Unavailable ? 0 : request.AvailableCount;
            availability.Status = request.Status;
            availability.IsClosed = request.Status == AvailabilityStatus.Unavailable;
            availability.MinNightsOverride = request.MinNightsOverride;
        }

        AddInventoryAudit(
            userId,
            roomType.PropertyId,
            1,
            request.StartDate,
            request.EndDate,
            request.AvailableCount,
            request.Status);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetAsync(
            userId,
            role,
            roomTypeId,
            request.StartDate,
            request.EndDate,
            cancellationToken);
    }

    private async Task<PropertyInventoryResponse> BuildPropertyInventoryAsync(
        int propertyId,
        DateOnly monthStart,
        DateOnly monthEnd,
        CancellationToken cancellationToken)
    {
        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive)
            .OrderBy(roomType => roomType.Name)
            .Select(roomType => new
            {
                roomType.Id,
                roomType.Name,
                roomType.InventoryMode,
                roomType.TotalInventory
            })
            .ToListAsync(cancellationToken);

        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var availabilityRows = await dbContext.Availabilities.AsNoTracking()
            .Where(availability => roomTypeIds.Contains(availability.RoomTypeId) &&
                                   availability.Date >= monthStart &&
                                   availability.Date <= monthEnd)
            .ToListAsync(cancellationToken);
        var availabilityMap = availabilityRows.ToDictionary(row => (row.RoomTypeId, row.Date));
        var claimedCounts = await GetClaimedCountsAsync(roomTypeIds, monthStart, monthEnd, cancellationToken);
        var days = Enumerable.Range(0, monthEnd.DayNumber - monthStart.DayNumber + 1)
            .Select(offset => monthStart.AddDays(offset))
            .ToList();

        return new PropertyInventoryResponse
        {
            PropertyId = propertyId,
            Month = $"{monthStart.Year:D4}-{monthStart.Month:D2}",
            StartDate = monthStart,
            EndDate = monthEnd,
            RoomTypes = roomTypes.Select(roomType => new InventoryRoomTypeResponse
            {
                RoomTypeId = roomType.Id,
                Name = roomType.Name,
                InventoryMode = roomType.InventoryMode,
                TotalInventory = roomType.TotalInventory,
                Days = days.Select(date =>
                {
                    availabilityMap.TryGetValue((roomType.Id, date), out var availability);
                    var configuredCount = availability?.AvailableCount ?? Math.Max(0, roomType.TotalInventory);
                    var count = Math.Max(
                        0,
                        configuredCount - claimedCounts.GetValueOrDefault((roomType.Id, date)));
                    return new InventoryDayResponse
                    {
                        AvailabilityId = availability?.Id,
                        RoomTypeId = roomType.Id,
                        Date = date,
                        AvailableCount = count,
                        Status = EffectiveStatus(
                            availability?.Status ?? (configuredCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available),
                            count)
                    };
                }).ToList()
            }).ToList()
        };
    }

    private Availability UpsertInventoryEntity(
        RoomType roomType,
        DateOnly date,
        int availableCount,
        Availability? availability,
        AvailabilityStatus? status = null)
    {
        if (availability is null)
        {
            availability = new Availability
            {
                RoomTypeId = roomType.Id,
                Date = date,
                Price = roomType.BasePrice ?? 0
            };
            dbContext.Availabilities.Add(availability);
        }

        availability.AvailableCount = availableCount;
        availability.Status = status ?? (availableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available);
        availability.IsClosed = availability.Status == AvailabilityStatus.Unavailable;
        return availability;
    }

    private async Task<Dictionary<(int RoomTypeId, DateOnly Date), int>> GetClaimedCountsAsync(
        IReadOnlyCollection<int> roomTypeIds,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var reservations = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                roomTypeIds.Contains(reservation.RoomTypeId) &&
                reservation.CheckInDate <= to &&
                reservation.CheckOutDate > from &&
                (reservation.Status == ReservationStatus.Confirmed ||
                 reservation.Status == ReservationStatus.Paid) &&
                reservation.Payments.Any(payment => payment.Status == PaymentStatus.Successful))
            .Select(reservation => new
            {
                reservation.RoomTypeId,
                reservation.CheckInDate,
                reservation.CheckOutDate
            })
            .ToListAsync(cancellationToken);

        var counts = new Dictionary<(int RoomTypeId, DateOnly Date), int>();
        foreach (var reservation in reservations)
        {
            var firstDate = reservation.CheckInDate < from ? from : reservation.CheckInDate;
            var lastDate = reservation.CheckOutDate > to.AddDays(1) ? to.AddDays(1) : reservation.CheckOutDate;
            for (var date = firstDate; date < lastDate; date = date.AddDays(1))
            {
                var key = (reservation.RoomTypeId, date);
                counts[key] = counts.GetValueOrDefault(key) + 1;
            }
        }

        return counts;
    }

    private static AvailabilityStatus EffectiveStatus(AvailabilityStatus configuredStatus, int effectiveCount) =>
        effectiveCount <= 0 ? AvailabilityStatus.Unavailable : configuredStatus;

    private async Task EnsureCanManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var propertyExists = await dbContext.Properties.AsNoTracking()
            .AnyAsync(item => item.Id == propertyId, cancellationToken);
        if (!propertyExists)
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanManageAvailabilityAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage availability for this property.");
        }
    }

    private async Task<RoomType> EnsureCanManageAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CancellationToken cancellationToken)
    {
        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .Include(item => item.Property)
            .Where(item => item.Id == roomTypeId)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        if (!await propertyAccessService.CanManageAvailabilityAsync(userId, role, roomType.PropertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage availability for this room type.");
        }

        return roomType;
    }

    private static void ValidateAvailableCount(RoomType roomType, int availableCount)
    {
        if (availableCount < 0)
        {
            throw new ArgumentException("Available count cannot be negative.");
        }

        var maxCount = roomType.TotalInventory;
        if (availableCount > maxCount)
        {
            throw new ArgumentException($"Available count cannot exceed {maxCount} for this room type.");
        }
    }

    private static void ValidateDateRange(DateOnly from, DateOnly to)
    {
        if (from > to)
        {
            throw new ArgumentException("The start date must be on or before the end date.");
        }
    }

    private void AddInventoryAudit(
        int userId,
        int propertyId,
        int roomTypeCount,
        DateOnly from,
        DateOnly to,
        int availableCount,
        AvailabilityStatus status)
    {
        auditLogService.Add(
            userId,
            AuditAction.InventoryChanged,
            "Availability",
            propertyId: propertyId,
            entityName: $"{roomTypeCount} room type(s)",
            description: $"Status: {status}, capacity: {availableCount}, {from:yyyy-MM-dd} to {to:yyyy-MM-dd}");
    }
}
