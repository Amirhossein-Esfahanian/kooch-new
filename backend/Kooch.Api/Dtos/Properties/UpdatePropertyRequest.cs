using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class UpdatePropertyRequest
{
    [Range(1, int.MaxValue)]
    public int DestinationId { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? EnglishName { get; set; }

    [MaxLength(220)]
    public string? Slug { get; set; }

    [MaxLength(4000)]
    public string Description { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? SeoTitle { get; set; }

    [MaxLength(500)]
    public string? SeoDescription { get; set; }

    [Required, MaxLength(500)]
    public string Address { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string City { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string Country { get; set; } = string.Empty;

    [Range(-90, 90)]
    public decimal? Latitude { get; set; }

    [Range(-180, 180)]
    public decimal? Longitude { get; set; }

    public PropertyType Type { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public TimeOnly? CheckInTime { get; set; }
    public TimeOnly? CheckOutTime { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? TotalAreaM2 { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? LandAreaM2 { get; set; }

    [Range(1, int.MaxValue)]
    public int? FloorsCount { get; set; }

    [Range(0, int.MaxValue)]
    public int? StairCount { get; set; }

    public bool HasElevator { get; set; }

    
}
