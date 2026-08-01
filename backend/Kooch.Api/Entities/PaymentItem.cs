namespace Kooch.Api.Entities;

public class PaymentItem : BaseEntity
{
    public int PaymentId { get; set; }
    public int ReservationId { get; set; }
    public decimal AllocatedAmount { get; set; }
    public string Currency { get; set; } = string.Empty;

    public Payment Payment { get; set; } = null!;
    public Reservation Reservation { get; set; } = null!;
}
