namespace Kooch.Api.Entities;

public class NearbyPlace : BaseEntity
{
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
    public bool IsActive { get; set; } = true;

    public Property Property { get; set; } = null!;
}
