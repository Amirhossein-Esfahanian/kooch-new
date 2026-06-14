namespace Kooch.Api.Entities;

public class AmenityCategory : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public string? Icon { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<Amenity> Amenities { get; set; } = [];
}
