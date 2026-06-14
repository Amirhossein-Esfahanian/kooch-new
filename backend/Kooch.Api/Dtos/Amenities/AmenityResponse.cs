using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Amenities;

public class AmenityResponse
{
    public int Id { get; set; }
    public int AmenityCategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategorySlug { get; set; } = string.Empty;
    public int CategorySortOrder { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public AmenityScope Scope { get; set; }
    public int SortOrder { get; set; }
}
