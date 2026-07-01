namespace Kooch.Api.Entities;

public class RoomDailyPriceHistory : BaseEntity
{
    public int PropertyId { get; set; }
    public int RoomTypeId { get; set; }
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public DateOnly AffectedDateFrom { get; set; }
    public DateOnly AffectedDateTo { get; set; }
    public decimal OldBasePrice { get; set; }
    public decimal NewBasePrice { get; set; }
    public decimal OldChildPrice { get; set; }
    public decimal NewChildPrice { get; set; }
    public decimal OldExtraGuestPrice { get; set; }
    public decimal NewExtraGuestPrice { get; set; }
    public int? ChangedByUserId { get; set; }
    public DateTime ChangedAtUtc { get; set; } = DateTime.UtcNow;

    public RoomType RoomType { get; set; } = null!;
    public User User { get; set; } = null!;
}
