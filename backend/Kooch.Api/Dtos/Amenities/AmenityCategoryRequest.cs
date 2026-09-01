using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Amenities;

public class AmenityCategoryRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Slug { get; set; }
    public int SortOrder { get; set; }
    [MaxLength(64)]
    public string? IconUploadToken { get; set; }
    public bool RemoveIcon { get; set; }
    public bool IsActive { get; set; } = true;
}
