namespace Kooch.Api.Entities;

public class TravelPurpose : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ICollection<PropertyTravelPurpose> PropertyTravelPurposes { get; set; } = [];
}
