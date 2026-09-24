namespace Kooch.Api.Entities;

public class PropertyCommissionRate : BaseEntity
{
    public int PropertyId { get; set; }
    public CommissionType CommissionType { get; set; }
    public decimal Rate { get; set; }
    public bool IsEnabled { get; set; } = true;

    public Property Property { get; set; } = null!;
}
