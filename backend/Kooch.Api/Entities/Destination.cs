namespace Kooch.Api.Entities;

public class Destination : BaseEntity
{
    public int? ParentDestinationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Country { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }

    public Destination? ParentDestination { get; set; }
    public SeoMetadata? SeoMetadata { get; set; }
    public ICollection<Destination> Children { get; set; } = [];
    public ICollection<Property> Properties { get; set; } = [];
    public ICollection<DefaultNearbyPlace> DefaultNearbyPlaces { get; set; } = [];
}
