using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed record DatedPropertyPrice(decimal StartingPrice, IReadOnlySet<int> MatchingRoomTypeIds);

public sealed class DatedPropertyStartingPriceService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService availabilityService,
    IChildPricingRuleResolver childPricingRuleResolver,
    ReservationPricingService pricingService)
{
    public async Task<IReadOnlyDictionary<int, DatedPropertyPrice>> GetAsync(
        IReadOnlyCollection<int> propertyIds,
        DateOnly checkIn,
        DateOnly checkOut,
        int rooms,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken)
    {
        if (propertyIds.Count == 0) return new Dictionary<int, DatedPropertyPrice>();

        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Include(roomType => roomType.Property)
            .Where(roomType => propertyIds.Contains(roomType.PropertyId) && roomType.IsActive)
            .ToListAsync(cancellationToken);
        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        if (roomTypeIds.Length == 0) return new Dictionary<int, DatedPropertyPrice>();

        var dailyPrices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) &&
                price.GuestType == PricingGuestType.Iranian &&
                price.Date >= checkIn && price.Date < checkOut)
            .ToListAsync(cancellationToken);
        var pricesByRoomType = dailyPrices
            .GroupBy(price => price.RoomTypeId)
            .ToDictionary(group => group.Key,
                group => (IReadOnlyDictionary<DateOnly, RoomDailyPrice>)group.ToDictionary(price => price.Date));
        var plans = await dbContext.RatePlans.AsNoTracking()
            .Include(plan => plan.MealPlan)
            .Where(plan => roomTypeIds.Contains(plan.RoomTypeId) && plan.IsActive &&
                plan.PriceModifierType == PriceModifierType.FixedAmount &&
                (!plan.MinimumNights.HasValue ||
                 plan.MinimumNights > 0 && plan.MinimumNights <= checkOut.DayNumber - checkIn.DayNumber))
            .ToListAsync(cancellationToken);
        var plansByRoomType = plans.GroupBy(plan => plan.RoomTypeId)
            .ToDictionary(group => group.Key, group => group.ToArray());
        var promotions = await dbContext.Promotions.AsNoTracking()
            .Include(promotion => promotion.PromotionRoomTypes)
            .Where(promotion => promotion.IsActive && promotion.StartDate < checkOut &&
                promotion.EndDate >= checkIn &&
                promotion.PromotionRoomTypes.Any(join => roomTypeIds.Contains(join.RoomTypeId)))
            .ToListAsync(cancellationToken);
        var availability = await availabilityService.GetRangeAsync(
            roomTypeIds, checkIn, checkOut, cancellationToken: cancellationToken);
        var globalChildRules = await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken);
        var bookingDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var nights = checkOut.DayNumber - checkIn.DayNumber;
        var matches = new Dictionary<int, (decimal Price, HashSet<int> RoomTypeIds)>();

        foreach (var roomType in roomTypes)
        {
            if (!PublicBookingOptionsService.CanAccommodate(roomType, adults, children, rooms) ||
                !availability.TryGetValue(roomType.Id, out var available) ||
                !available.HasCapacityForFullRange(rooms) ||
                !pricesByRoomType.TryGetValue(roomType.Id, out var prices))
                continue;

            var rules = ReservationRulesResolver.ResolveFromLoadedRoomType(
                roomType, globalChildRules, childPricingRuleResolver);
            var applicablePromotions = promotions.Where(promotion =>
                (promotion.PropertyId is null || promotion.PropertyId == roomType.PropertyId) &&
                promotion.PromotionRoomTypes.Any(join => join.RoomTypeId == roomType.Id)).ToArray();
            var offers = new RatePlan?[] { null }.Concat(
                plansByRoomType.GetValueOrDefault(roomType.Id) ?? []);
            foreach (var plan in offers)
            {
                var request = new ReservationPricePreviewRequest
                {
                    PropertyId = roomType.PropertyId,
                    RoomTypeId = roomType.Id,
                    RatePlanId = plan?.Id,
                    CheckInDate = checkIn,
                    CheckOutDate = checkOut,
                    RoomCount = rooms,
                    Adults = adults,
                    Children = children,
                    ChildAges = childAges,
                    GuestType = PricingGuestType.Iranian
                };
                try
                {
                    var quote = pricingService.CalculateLoadedPrice(
                        request, roomType, plan, prices, applicablePromotions, rules, bookingDate);
                    var average = quote.FinalAmount / nights;
                    if (!matches.TryGetValue(roomType.PropertyId, out var current))
                    {
                        matches[roomType.PropertyId] = (average, [roomType.Id]);
                    }
                    else
                    {
                        current.RoomTypeIds.Add(roomType.Id);
                        matches[roomType.PropertyId] = (Math.Min(current.Price, average), current.RoomTypeIds);
                    }
                }
                catch (Exception error) when (error is IncompleteDailyPricingException or
                    ArgumentException or InvalidOperationException or KeyNotFoundException)
                {
                    // An ineligible or unpriceable offer cannot set the dated starting price.
                }
            }
        }

        return matches.ToDictionary(pair => pair.Key,
            pair => new DatedPropertyPrice(pair.Value.Price, pair.Value.RoomTypeIds));
    }
}
