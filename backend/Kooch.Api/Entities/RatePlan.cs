namespace Kooch.Api.Entities;

public class RatePlan : BaseEntity
{
    public int RoomTypeId { get; set; }
    public int? CancellationPolicyId { get; set; }
    public int? MealPlanId { get; set; }
    public string Name { get; set; } = string.Empty;
    public PriceModifierType PriceModifierType { get; set; }
    public decimal PriceModifierValue { get; set; }
    public int? MinimumNights { get; set; }
    public bool IsActive { get; set; } = true;

    public RoomType RoomType { get; set; } = null!;
    public CancellationPolicy? CancellationPolicy { get; set; }
    public MealPlan? MealPlan { get; set; }
    public ICollection<Reservation> Reservations { get; set; } = [];
}
