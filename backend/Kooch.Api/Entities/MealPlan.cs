namespace Kooch.Api.Entities;

public class MealPlan : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }

    public ICollection<RatePlan> RatePlans { get; set; } = [];
}
