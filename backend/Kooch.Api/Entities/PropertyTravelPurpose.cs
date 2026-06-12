namespace Kooch.Api.Entities;

public class PropertyTravelPurpose : BaseEntity
{
    public int PropertyId { get; set; }
    public int TravelPurposeId { get; set; }
    public int? Score { get; set; }
    public string? Note { get; set; }

    public Property Property { get; set; } = null!;
    public TravelPurpose TravelPurpose { get; set; } = null!;
}
