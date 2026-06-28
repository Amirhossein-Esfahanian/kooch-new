namespace Kooch.Api.Entities;

public class RoomDailyPriceHistory : BaseEntity
{
    public int RoomTypeId { get; set; }
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public decimal OldPrice { get; set; }
    public decimal NewPrice { get; set; }
    public int UserId { get; set; }
    public DateTime ChangedAtUtc { get; set; } = DateTime.UtcNow;
    public DateOnly AffectedStartDate { get; set; }
    public DateOnly AffectedEndDate { get; set; }

    public RoomType RoomType { get; set; } = null!;
    public User User { get; set; } = null!;
}
