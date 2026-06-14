using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class AvailabilityService(KoochDbContext dbContext) : IAvailabilityService
{
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
        if (request.AvailableCount < 0)
        {
            throw new ArgumentException("Available count cannot be negative.");
        }

        await EnsureCanManageAsync(userId, role, roomTypeId, cancellationToken);

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
            availability.AvailableCount = request.AvailableCount;
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

    private async Task EnsureCanManageAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CancellationToken cancellationToken)
    {
        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .Where(item => item.Id == roomTypeId)
            .Select(item => new { item.PropertyId, item.Property.OwnerId })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        var canManage = role switch
        {
            UserRole.SuperAdmin => true,
            UserRole.Owner => roomType.OwnerId == userId,
            UserRole.OwnerAssistant => await dbContext.UserPropertyAccesses.AsNoTracking()
                .AnyAsync(access => access.UserId == userId &&
                                    access.PropertyId == roomType.PropertyId &&
                                    access.IsActive &&
                                    access.CanManageAvailability,
                    cancellationToken),
            _ => false
        };

        if (!canManage)
        {
            throw new UnauthorizedAccessException("You cannot manage availability for this room type.");
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
