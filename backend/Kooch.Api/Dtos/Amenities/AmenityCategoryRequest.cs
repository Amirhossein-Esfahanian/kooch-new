namespace Kooch.Api.Dtos.Amenities;

public class AmenityCategoryRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Slug { get; set; }
    public int SortOrder { get; set; }
    public string? Icon { get; set; }
    public bool IsActive { get; set; } = true;
}
