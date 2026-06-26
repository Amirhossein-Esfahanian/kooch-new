namespace Kooch.Api.Entities;

/// <summary>
/// Placeholder domain model for future manual coupon-code discounts.
///
/// Promotions are automatic and applied by the promotion engine.
/// Coupons are manual code entries that will be validated and applied later.
///
/// Future pricing order:
/// RoomDailyPrice → Promotion → Coupon → Commission → FinalPayablePrice.
/// </summary>
public class Coupon : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public CouponType Type { get; set; }
    public decimal? Percentage { get; set; }
    public decimal? Amount { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public int? MaxUsageCount { get; set; }
    public int? MaxUsagePerUser { get; set; }
    public decimal? MinimumOrderAmount { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<CouponUsage> Usages { get; set; } = [];
}

public class CouponUsage : BaseEntity
{
    public int CouponId { get; set; }
    public int? UserId { get; set; }
    public int? ReservationId { get; set; }
    public decimal DiscountAmount { get; set; }
    public DateTime UsedAtUtc { get; set; }

    public Coupon Coupon { get; set; } = null!;
    public User? User { get; set; }
    public Reservation? Reservation { get; set; }
}
