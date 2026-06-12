namespace Kooch.Api.Entities;

public class CancellationPolicy : BaseEntity
{
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int? FreeCancellationDays { get; set; }
    public decimal? PenaltyPercentage { get; set; }

    public Property Property { get; set; } = null!;
    public ICollection<RatePlan> RatePlans { get; set; } = [];
}
