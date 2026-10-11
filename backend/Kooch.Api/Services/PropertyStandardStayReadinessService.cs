using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PropertyStandardStayReadinessService(KoochDbContext dbContext)
    : IPropertyStandardStayReadinessService
{
    internal const int ReadinessHorizonDays = 60;

    public async Task<PropertyStandardStayReadiness> EvaluateAsync(
        int propertyId,
        DateOnly today,
        CancellationToken cancellationToken = default)
    {
        var endExclusive = today.AddDays(ReadinessHorizonDays);
        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive &&
                roomType.MaxAdults >= 1 && roomType.TotalInventory >= 1)
            .Select(roomType => new { roomType.Id, roomType.TotalInventory })
            .ToArrayAsync(cancellationToken);
        if (roomTypes.Length == 0)
            return new PropertyStandardStayReadiness(false, false, false);

        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var pricedNights = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) &&
                price.GuestType == PricingGuestType.Iranian &&
                price.Date >= today && price.Date < endExclusive && price.BasePrice > 0)
            .Select(price => new { price.RoomTypeId, price.Date })
            .ToArrayAsync(cancellationToken);
        var availabilityRows = await dbContext.Availabilities.AsNoTracking()
            .Where(availability => roomTypeIds.Contains(availability.RoomTypeId) &&
                availability.Date >= today && availability.Date < endExclusive)
            .Select(availability => new
            {
                availability.RoomTypeId,
                availability.Date,
                availability.IsClosed,
                availability.Status,
                availability.AvailableCount
            })
            .ToDictionaryAsync(row => (row.RoomTypeId, row.Date), cancellationToken);

        // A missing daily row inherits the RoomType inventory and Available status.
        bool IsConfiguredAvailable(int roomTypeId, DateOnly date) =>
            !availabilityRows.TryGetValue((roomTypeId, date), out var row) ||
            (!row.IsClosed && row.AvailableCount >= 1 &&
             row.Status is AvailabilityStatus.Available or AvailabilityStatus.OnRequest);

        var hasConfiguredAvailability = roomTypes.Any(roomType =>
            Enumerable.Range(0, ReadinessHorizonDays)
                .Any(offset => IsConfiguredAvailable(roomType.Id, today.AddDays(offset))));
        var hasJointStay = pricedNights.Any(night => IsConfiguredAvailable(night.RoomTypeId, night.Date));

        return new PropertyStandardStayReadiness(
            pricedNights.Length > 0,
            hasConfiguredAvailability,
            hasJointStay);
    }
}
