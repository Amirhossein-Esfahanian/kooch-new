namespace Kooch.Api.Entities;

public class Amenity : BaseEntity
{
    public int AmenityCategoryId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public AmenityScope Scope { get; set; }
    public int SortOrder { get; set; }

    public AmenityCategory AmenityCategory { get; set; } = null!;
    public ICollection<PropertyAmenity> PropertyAmenities { get; set; } = [];
    public ICollection<RoomTypeAmenity> RoomTypeAmenities { get; set; } = [];
}
