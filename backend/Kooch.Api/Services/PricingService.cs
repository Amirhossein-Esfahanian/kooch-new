using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

/// <summary>
/// Contains reservation price rules that are independent from reservation persistence.
///
/// Current dynamic calculation order:
/// RoomDailyPrice → Promotion Engine → FinalPrice.
///
/// Future checkout order:
/// RoomDailyPrice → Promotion → Coupon → Commission → FinalPayablePrice.
///
/// RoomDailyPrice stores the room/day base price; child and extra guest prices are property-level rules.
/// </summary>
public sealed class PricingService
{
    /// <summary>
    /// Applies active promotions dynamically to a supplied nightly price. Discounted prices
    /// are never persisted. Applicable promotions are applied by SortOrder, then Id.
    /// Informational promotions are display-only and ignored for price calculation.
    /// </summary>
    public PromotionPriceResult CalculateFinalPrice(
        decimal basePrice,
        int roomTypeId,
        DateOnly stayDate,
        DateOnly bookingDate,
        IEnumerable<Promotion> promotions)
    {
        if (basePrice < 0) throw new ArgumentOutOfRangeException(nameof(basePrice));
        return CalculateStayPrices([(stayDate, basePrice)], roomTypeId, bookingDate, promotions)[0];
    }

    /// <summary>
    /// Applies promotions in their existing order across the stay. Results retain input-night
    /// order; equal remaining amounts select the first eligible night in that order.
    /// </summary>
    public IReadOnlyList<PromotionPriceResult> CalculateStayPrices(
        IReadOnlyList<(DateOnly Date, decimal BasePrice)> nights,
        int roomTypeId,
        DateOnly bookingDate,
        IEnumerable<Promotion> promotions)
    {
        ArgumentNullException.ThrowIfNull(nights);
        if (nights.Any(night => night.BasePrice < 0)) throw new ArgumentOutOfRangeException(nameof(nights));
        ArgumentNullException.ThrowIfNull(promotions);

        var remaining = nights.Select(night => night.BasePrice).ToArray();
        var applied = nights.Select(_ => new List<AppliedPromotionResponse>()).ToArray();
        foreach (var promotion in promotions
                     .OrderBy(item => item.SortOrder).ThenBy(item => item.Id))
        {
            var eligible = Enumerable.Range(0, nights.Count)
                .Where(index => IsApplicable(promotion, roomTypeId, nights[index].Date, bookingDate))
                .ToList();
            if (eligible.Count == 0) continue;

            if (promotion.Type == PromotionType.StayXGetOneFree)
            {
                if (promotion.MinimumStayNights is null or < 1)
                    throw new ArgumentException("Free-night promotion requires a positive minimum stay.", nameof(promotions));
                if (nights.Count < promotion.MinimumStayNights.Value) continue;

                var selected = eligible.OrderBy(index => remaining[index]).First();
                applied[selected].Add(new AppliedPromotionResponse(promotion.Id, promotion.Title, remaining[selected]));
                remaining[selected] = 0;
                continue;
            }

            foreach (var index in eligible)
            {
                var basePrice = nights[index].BasePrice;
                var finalPrice = remaining[index];
                decimal discount;
                switch (promotion.Type)
                {
                    case PromotionType.PercentageDiscount:
                    case PromotionType.LastMinute:
                        if (promotion.Percentage is null or < 0 or > 100)
                            throw new ArgumentException("Promotion percentage must be between 0 and 100.", nameof(promotions));
                        discount = finalPrice * promotion.Percentage.Value / 100m;
                        break;
                    case PromotionType.FixedAmountDiscount:
                        if (promotion.Amount is null or < 0 || promotion.Amount > basePrice)
                            throw new ArgumentException("Promotion amount must be between zero and the base price.", nameof(promotions));
                        discount = Math.Min(finalPrice, promotion.Amount.Value);
                        break;
                    case PromotionType.Informational:
                        continue;
                    default:
                        continue;
                }

                remaining[index] = Math.Max(0, finalPrice - discount);
                applied[index].Add(new AppliedPromotionResponse(promotion.Id, promotion.Title, discount));
            }
        }

        return nights.Select((night, index) =>
            new PromotionPriceResult(night.BasePrice, remaining[index], applied[index])).ToArray();
    }

    /// <summary>
    /// Calculates one dynamic nightly price in the reservation pricing order:
    /// RoomDailyPrice → Promotion Engine → FinalPrice.
    ///
    /// Child/extra guest rules:
    /// - If guests fit inside MaxAdults + MaxChildren, charge BasePrice only.
    /// - If guests exceed capacity, extra adults use ExtraGuestPrice.
    /// - Extra counted children use ChildPrice.
    ///
    /// Examples:
    /// - Triple room capacity 3, 2 adults + 1 child → BasePrice only.
    /// - Double room capacity 2, 2 adults + 1 child → BasePrice + ChildPrice.
    ///
    /// The returned FinalPrice is dynamic and must not be stored as a discounted price.
    /// </summary>
    public ReservationNightPriceResult CalculatePromotedNightPrice(
        RoomType roomType,
        RoomDailyPrice dailyPrice,
        int adults,
        int countedChildren,
        DateOnly bookingDate,
        IEnumerable<Promotion> promotions)
    {
        ArgumentNullException.ThrowIfNull(roomType);
        ArgumentNullException.ThrowIfNull(dailyPrice);
        ArgumentNullException.ThrowIfNull(promotions);

        var roomDailyPrice = CalculateNightPrice(roomType, dailyPrice, adults, countedChildren);
        var promotionPrice = CalculateFinalPrice(
            roomDailyPrice.TotalPrice,
            roomType.Id,
            dailyPrice.Date,
            bookingDate,
            promotions);

        return new ReservationNightPriceResult
        {
            RoomDailyPriceCalculation = roomDailyPrice,
            PromotionCalculation = promotionPrice
        };
    }

    private static bool IsApplicable(
        Promotion promotion, int roomTypeId, DateOnly stayDate, DateOnly bookingDate)
    {
        if (!promotion.IsActive || stayDate < promotion.StartDate || stayDate > promotion.EndDate)
            return false;
        if (!promotion.PromotionRoomTypes.Any(item => item.RoomTypeId == roomTypeId))
            return false;

        var weekday = PromotionService.ToWeekdayMask([stayDate.DayOfWeek]);
        if ((promotion.Weekdays & weekday) == 0) return false;

        return promotion.Type != PromotionType.LastMinute ||
               promotion.LastMinuteDays is >= 0 &&
               stayDate.DayNumber >= bookingDate.DayNumber &&
               stayDate.DayNumber - bookingDate.DayNumber <= promotion.LastMinuteDays.Value;
    }

    /// <summary>
    /// Calculates one night's room price.
    ///
    /// Rules:
    /// - Base capacity is MaxAdults + MaxChildren.
    /// - Guest count is adults + counted children (children already filtered by child-policy rules).
    /// - BasePrice covers every guest while guest count is within base capacity.
    /// - Only guests above the combined base capacity receive a surcharge.
    /// - Adults above MaxAdults occupy extra-guest slots and use ExtraGuestPrice.
    /// - Any remaining excess guests are counted children and use ChildPrice.
    ///
    /// Guest eligibility and room availability must be validated by the future reservation
    /// engine; this method is intentionally limited to price calculation.
    /// </summary>
    public ReservationPriceCalculation CalculateNightPrice(
        RoomType roomType,
        RoomDailyPrice dailyPrice,
        int adults,
        int countedChildren)
    {
        ArgumentNullException.ThrowIfNull(roomType);
        ArgumentNullException.ThrowIfNull(dailyPrice);

        return CalculateNightPrice(
            roomType.MaxAdults,
            roomType.MaxChildren,
            dailyPrice.BasePrice,
            roomType.Property?.ChildPrice ?? 0,
            roomType.Property?.ExtraGuestPrice ?? 0,
            adults,
            countedChildren);
    }

    public ReservationPriceCalculation CalculateNightPrice(
        int maxAdults,
        int maxChildren,
        decimal basePrice,
        decimal childPrice,
        decimal extraGuestPrice,
        int adults,
        int countedChildren)
    {
        ValidateInputs(maxAdults, maxChildren, basePrice, childPrice, extraGuestPrice, adults, countedChildren);

        var baseCapacity = checked(maxAdults + maxChildren);
        var guestCount = checked(adults + countedChildren);
        var excessGuestCount = Math.Max(0, guestCount - baseCapacity);

        // Adults only become chargeable when both the combined room capacity and the
        // adult allocation are exceeded. All other excess occupants are counted children.
        var extraAdultCount = Math.Min(excessGuestCount, Math.Max(0, adults - maxAdults));
        var extraChildCount = excessGuestCount - extraAdultCount;
        var extraGuestCharge = extraAdultCount * extraGuestPrice;
        var childCharge = extraChildCount * childPrice;

        return new ReservationPriceCalculation
        {
            BaseCapacity = baseCapacity,
            GuestCount = guestCount,
            ExtraAdultCount = extraAdultCount,
            ExtraChildCount = extraChildCount,
            BasePrice = basePrice,
            ChildCharge = childCharge,
            ExtraGuestCharge = extraGuestCharge,
            TotalPrice = basePrice + childCharge + extraGuestCharge
        };
    }

    private static void ValidateInputs(
        int maxAdults,
        int maxChildren,
        decimal basePrice,
        decimal childPrice,
        decimal extraGuestPrice,
        int adults,
        int countedChildren)
    {
        if (maxAdults < 0) throw new ArgumentOutOfRangeException(nameof(maxAdults));
        if (maxChildren < 0) throw new ArgumentOutOfRangeException(nameof(maxChildren));
        if (adults < 0) throw new ArgumentOutOfRangeException(nameof(adults));
        if (countedChildren < 0) throw new ArgumentOutOfRangeException(nameof(countedChildren));
        if (basePrice < 0) throw new ArgumentOutOfRangeException(nameof(basePrice));
        if (childPrice < 0) throw new ArgumentOutOfRangeException(nameof(childPrice));
        if (extraGuestPrice < 0) throw new ArgumentOutOfRangeException(nameof(extraGuestPrice));
    }
}
