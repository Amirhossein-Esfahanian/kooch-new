using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PublicRoomTypeCalendarService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService)
{
    public async Task<PublicRoomTypeCalendarResponse?> GetAsync(
        string slug,
        int roomTypeId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default)
    {
        if (from > to || to == DateOnly.MaxValue || to.DayNumber - from.DayNumber > 62)
        {
            throw new ArgumentException("Invalid calendar date range (maximum 63 days).");
        }

        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        var eligibleRoomType = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.Id == roomTypeId && roomType.IsActive &&
                roomType.Property.Status == PropertyStatus.Approved &&
                roomType.Property.Slug == normalizedSlug)
            .Select(roomType => new { roomType.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (eligibleRoomType is null) return null;

        var prices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price => price.RoomTypeId == roomTypeId &&
                price.GuestType == PricingGuestType.Iranian &&
                price.Date >= from && price.Date <= to)
            .Select(price => new { price.Date, price.BasePrice })
            .ToDictionaryAsync(price => price.Date, cancellationToken);
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            [roomTypeId], from, to.AddDays(1), cancellationToken: cancellationToken);
        var nights = availability[roomTypeId].Nights;

        return new PublicRoomTypeCalendarResponse
        {
            RoomTypeId = roomTypeId,
            From = from,
            To = to,
            Days = Enumerable.Range(0, to.DayNumber - from.DayNumber + 1)
                .Select(offset =>
                {
                    var date = from.AddDays(offset);
                    var night = nights[date];
                    return new PublicRoomTypeCalendarDayResponse
                    {
                        Date = date,
                        StandardPrice = prices.TryGetValue(date, out var price) ? price.BasePrice : null,
                        AvailableUnits = night.RemainingCapacity,
                        AvailabilityStatus = night.EffectiveStatus
                    };
                }).ToArray()
        };
    }
}
