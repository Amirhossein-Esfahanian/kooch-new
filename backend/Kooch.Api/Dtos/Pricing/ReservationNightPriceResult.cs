using Kooch.Api.Dtos.Promotions;

namespace Kooch.Api.Dtos.Pricing;

public sealed record ReservationNightPriceResult
{
    public ReservationPriceCalculation RoomDailyPriceCalculation { get; init; } = new();
    public PromotionPriceResult PromotionCalculation { get; init; } = new(0, 0, []);

    /// <summary>
    /// Dynamic final nightly price after RoomDailyPrice and automatic promotions.
    /// This value is calculated only; it must not be stored as a discounted price.
    /// Future checkout order:
    /// RoomDailyPrice → Promotion → Coupon → Commission → FinalPayablePrice.
    /// </summary>
    public decimal FinalPrice => PromotionCalculation.FinalPrice;
}
