namespace Kooch.Api.Dtos.Amenities;

public class AmenityCategoryResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public string? Icon { get; set; }
    public bool IsActive { get; set; }
}
