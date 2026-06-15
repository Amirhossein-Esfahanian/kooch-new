using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class NearbyPlaceRequest
{
    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    public NearbyPlaceCategory Category { get; set; }
    public int? DistanceInMeters { get; set; }
    public int? WalkingMinutes { get; set; }
    public int? DrivingMinutes { get; set; }

    [MaxLength(1000)]
    public string? Description { get; set; }

    [Range(-90, 90)]
    public decimal? Latitude { get; set; }

    [Range(-180, 180)]
    public decimal? Longitude { get; set; }

    public bool IsDefault { get; set; }
    public bool IsCustom { get; set; }
    public bool IsActive { get; set; } = true;
}

public class NearbyPlaceResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public string Title { get; set; } = string.Empty;
    public NearbyPlaceCategory Category { get; set; }
    public int? DistanceInMeters { get; set; }
    public int? WalkingMinutes { get; set; }
    public int? DrivingMinutes { get; set; }
    public string? Description { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public bool IsDefault { get; set; }
    public bool IsCustom { get; set; }
    public bool IsActive { get; set; }
}
