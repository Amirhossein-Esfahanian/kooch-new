namespace Kooch.Api.Entities;

public class DefaultNearbyPlace : BaseEntity
{
    public int DestinationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public NearbyPlaceCategory Category { get; set; }
    public string? Description { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public bool IsActive { get; set; } = true;

    public Destination Destination { get; set; } = null!;
}
