using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

/// <summary>
/// Contains reservation price rules that are independent from reservation persistence.
/// The future reservation engine should calculate each stay date with that date's
/// <see cref="RoomDailyPrice"/> and sum the returned nightly totals.
/// </summary>
public sealed class PricingService
{
    /// <summary>
    /// Applies active promotions dynamically to a supplied base price. Discounted prices
    /// are never persisted. Applicable promotions are applied by SortOrder, then Id.
    /// Informational promotions are returned with a zero discount and do not change price.
    /// </summary>
    public PromotionPriceResult CalculateFinalPrice(
        decimal basePrice,
        int roomTypeId,
        DateOnly stayDate,
        DateOnly bookingDate,
        IEnumerable<Promotion> promotions)
    {
        if (basePrice < 0) throw new ArgumentOutOfRangeException(nameof(basePrice));
        ArgumentNullException.ThrowIfNull(promotions);

        var finalPrice = basePrice;
        var applied = new List<AppliedPromotionResponse>();
        foreach (var promotion in promotions
                     .Where(item => IsApplicable(item, roomTypeId, stayDate, bookingDate))
                     .OrderBy(item => item.SortOrder).ThenBy(item => item.Id))
        {
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
                    discount = 0;
                    break;
                default:
                    continue;
            }

            finalPrice = Math.Max(0, finalPrice - discount);
            applied.Add(new AppliedPromotionResponse(promotion.Id, promotion.Title, discount));
        }

        return new PromotionPriceResult(basePrice, finalPrice, applied);
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
            dailyPrice.ChildPrice,
            dailyPrice.ExtraGuestPrice,
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
