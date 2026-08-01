namespace Kooch.Api.Entities;

public class Payment : BaseEntity
{
    public int? ReservationId { get; set; }
    public int? BookingSessionId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRR";
    public PaymentStatus Status { get; set; }
    public string? Provider { get; set; }
    public string? TransactionReference { get; set; }
    public DateTime? PaidAtUtc { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public Reservation? Reservation { get; set; }
    public BookingSession? BookingSession { get; set; }
    public ICollection<PaymentItem> Items { get; set; } = [];
}
