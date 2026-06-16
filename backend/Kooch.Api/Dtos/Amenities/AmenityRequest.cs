using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Amenities;

public class AmenityRequest
{
    [Range(1, int.MaxValue)]
    public int AmenityCategoryId { get; set; }

    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(170)]
    public string? Slug { get; set; }

    [MaxLength(1000)]
    public string? Description { get; set; }

    [MaxLength(100)]
    public string? Icon { get; set; }

    public AmenityScope Scope { get; set; }

    public int SortOrder { get; set; }
}
