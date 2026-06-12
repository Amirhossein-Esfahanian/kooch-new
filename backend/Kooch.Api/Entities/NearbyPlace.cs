namespace Kooch.Api.Entities;

public class NearbyPlace : BaseEntity
{
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Category { get; set; }
    public decimal DistanceKm { get; set; }
    public int? WalkingMinutes { get; set; }
    public int? DrivingMinutes { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }

    public Property Property { get; set; } = null!;
}
