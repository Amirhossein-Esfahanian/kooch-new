namespace Kooch.Api.Entities;

public class RoomTypeAmenity : BaseEntity
{
    public int RoomTypeId { get; set; }
    public int AmenityId { get; set; }

    public RoomType RoomType { get; set; } = null!;
    public Amenity Amenity { get; set; } = null!;
}
