namespace Kooch.Api.Entities;

public class RoomTypeBed : BaseEntity
{
    public int RoomTypeId { get; set; }
    public int BedTypeId { get; set; }
    public int Quantity { get; set; }

    public RoomType RoomType { get; set; } = null!;
    public BedType BedType { get; set; } = null!;
}
