namespace Kooch.Api.Entities;

public class SeoMetadata : BaseEntity
{
    public int? PropertyId { get; set; }
    public int? DestinationId { get; set; }
    public string? PageKey { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? Keywords { get; set; }
    public string? CanonicalUrl { get; set; }
    public string? OpenGraphImageUrl { get; set; }

    public Property? Property { get; set; }
    public Destination? Destination { get; set; }
}
