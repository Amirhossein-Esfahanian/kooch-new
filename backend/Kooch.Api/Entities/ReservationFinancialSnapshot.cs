namespace Kooch.Api.Entities;

public class ReservationFinancialSnapshot : BaseEntity
{
    public int ReservationId { get; set; }
    public int PropertyId { get; set; }
    public int PaymentId { get; set; }
    public int? PaymentItemId { get; set; }
    public decimal GrossAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public CommissionType CommissionType { get; set; }
    public CommissionRateSource CommissionRateSource { get; set; }
    public decimal CommissionRate { get; set; }
    public decimal CommissionBase { get; set; }
    public decimal CommissionAmount { get; set; }
    public decimal PropertyPayableAmount { get; set; }
    public DateTime CalculatedAtUtc { get; set; }
    public string? CommissionPolicySource { get; set; }
    public string? CommissionPolicyVersion { get; set; }

    public Reservation Reservation { get; set; } = null!;
    public Property Property { get; set; } = null!;
    public Payment Payment { get; set; } = null!;
    public PaymentItem? PaymentItem { get; set; }
}
