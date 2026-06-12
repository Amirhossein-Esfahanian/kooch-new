namespace Kooch.Api.Entities;

public class Amenity : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public AmenityScope Scope { get; set; }

    public ICollection<PropertyAmenity> PropertyAmenities { get; set; } = [];
    public ICollection<RoomTypeAmenity> RoomTypeAmenities { get; set; } = [];
}
