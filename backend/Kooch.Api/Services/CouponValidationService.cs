using Kooch.Api.Entities;

namespace Kooch.Api.Services;

/// <summary>
/// Placeholder service for future coupon validation.
///
/// Coupons are intentionally separate from promotions:
/// - Promotion = automatic discount/display rule.
/// - Coupon = manual code entry applied later in checkout.
///
/// Future order:
/// RoomDailyPrice → Promotion → Coupon → Commission → FinalPayablePrice.
/// </summary>
public sealed class CouponValidationService
{
    public CouponValidationResult ValidatePlaceholder(
        Coupon? coupon,
        decimal promotedPrice,
        int? userId = null,
        DateOnly? stayDate = null)
    {
        if (coupon is null) return CouponValidationResult.Invalid("کوپن پیدا نشد.");
        if (!coupon.IsActive) return CouponValidationResult.Invalid("کوپن فعال نیست.");
        if (promotedPrice < 0) throw new ArgumentOutOfRangeException(nameof(promotedPrice));
        if (coupon.StartDate.HasValue && stayDate.HasValue && stayDate.Value < coupon.StartDate.Value)
            return CouponValidationResult.Invalid("کوپن هنوز قابل استفاده نیست.");
        if (coupon.EndDate.HasValue && stayDate.HasValue && stayDate.Value > coupon.EndDate.Value)
            return CouponValidationResult.Invalid("مهلت استفاده از کوپن به پایان رسیده است.");

        return CouponValidationResult.Valid();
    }
}

public sealed record CouponValidationResult(bool IsValid, string? ErrorMessage)
{
    public static CouponValidationResult Valid() => new(true, null);
    public static CouponValidationResult Invalid(string message) => new(false, message);
}
