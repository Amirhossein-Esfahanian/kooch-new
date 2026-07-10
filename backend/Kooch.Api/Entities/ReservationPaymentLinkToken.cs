namespace Kooch.Api.Entities;

public class ReservationPaymentLinkToken : BaseEntity
{
    public int ReservationId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UsedAtUtc { get; set; }

    public Reservation Reservation { get; set; } = null!;
}
