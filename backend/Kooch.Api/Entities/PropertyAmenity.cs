namespace Kooch.Api.Entities;

public class PropertyAmenity : BaseEntity
{
    public int PropertyId { get; set; }
    public int AmenityId { get; set; }

    public Property Property { get; set; } = null!;
    public Amenity Amenity { get; set; } = null!;
}
