namespace Kooch.Api.Entities;

public class RoomDailyPrice : BaseEntity
{
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
    public decimal BasePrice { get; set; }
    public decimal ChildPrice { get; set; }
    public decimal ExtraGuestPrice { get; set; }

    public RoomType RoomType { get; set; } = null!;
}
