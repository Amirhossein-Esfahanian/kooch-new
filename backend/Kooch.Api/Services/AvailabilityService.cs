using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class AvailabilityService(KoochDbContext dbContext) : IAvailabilityService
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

        await dbContext.SaveChangesAsync(cancellationToken);
        return updated
            .OrderBy(item => item.Date)
            .ThenBy(item => item.RoomTypeId)
            .Select(item => new InventoryDayResponse
            {
                AvailabilityId = item.Id,
                RoomTypeId = item.RoomTypeId,
                Date = item.Date,
                AvailableCount = item.AvailableCount,
                Status = item.Status
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
        await dbContext.SaveChangesAsync(cancellationToken);

        return new InventoryDayResponse
        {
            AvailabilityId = availability?.Id,
            RoomTypeId = roomType.Id,
            Date = request.Date,
            AvailableCount = request.AvailableCount,
            Status = request.AvailableCount == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available
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
        await dbContext.SaveChangesAsync(cancellationToken);

        return new InventoryDayResponse
        {
            AvailabilityId = availability.Id,
            RoomTypeId = availability.RoomTypeId,
            Date = availability.Date,
            AvailableCount = availability.AvailableCount,
            Status = availability.Status
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

        return await dbContext.Availabilities.AsNoTracking()
            .Where(availability => availability.RoomTypeId == roomTypeId &&
                                   availability.Date >= from &&
                                   availability.Date <= to)
            .OrderBy(availability => availability.Date)
            .Select(availability => new AvailabilityResponse
            {
                Id = availability.Id,
                RoomTypeId = availability.RoomTypeId,
                Date = availability.Date,
                Price = availability.Price,
                OriginalPrice = availability.OriginalPrice,
                AvailableCount = availability.AvailableCount,
                Status = availability.Status,
                MinNightsOverride = availability.MinNightsOverride
            })
            .ToListAsync(cancellationToken);
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
                    var count = availability?.AvailableCount ?? Math.Max(0, roomType.TotalInventory);
                    return new InventoryDayResponse
                    {
                        AvailabilityId = availability?.Id,
                        RoomTypeId = roomType.Id,
                        Date = date,
                        AvailableCount = count,
                        Status = availability?.Status ?? (count == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available)
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

    private async Task EnsureCanManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var property = await dbContext.Properties.AsNoTracking()
            .Where(item => item.Id == propertyId)
            .Select(item => new { item.Id, item.OwnerId })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var canManage = role switch
        {
            UserRole.SuperAdmin => true,
            UserRole.Owner => property.OwnerId == userId,
            UserRole.OwnerAssistant => await dbContext.UserPropertyAccesses.AsNoTracking()
                .AnyAsync(access => access.UserId == userId &&
                                    access.PropertyId == propertyId &&
                                    access.IsActive &&
                                    access.CanManageAvailability,
                    cancellationToken),
            UserRole.AdminAssistant => await dbContext.UserPermissions.AsNoTracking()
                .AnyAsync(permission => permission.UserId == userId &&
                                        permission.PermissionKey == PermissionKey.ManageAvailability &&
                                        permission.IsAllowed &&
                                        (permission.PropertyId == null || permission.PropertyId == propertyId),
                    cancellationToken),
            _ => false
        };

        if (!canManage)
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

        var canManage = role switch
        {
            UserRole.SuperAdmin => true,
            UserRole.Owner => roomType.Property.OwnerId == userId,
            UserRole.OwnerAssistant => await dbContext.UserPropertyAccesses.AsNoTracking()
                .AnyAsync(access => access.UserId == userId &&
                                    access.PropertyId == roomType.PropertyId &&
                                    access.IsActive &&
                                    access.CanManageAvailability,
                    cancellationToken),
            UserRole.AdminAssistant => await dbContext.UserPermissions.AsNoTracking()
                .AnyAsync(permission => permission.UserId == userId &&
                                        permission.PermissionKey == PermissionKey.ManageAvailability &&
                                        permission.IsAllowed &&
                                        (permission.PropertyId == null || permission.PropertyId == roomType.PropertyId),
                    cancellationToken),
            _ => false
        };

        if (!canManage)
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
}
