namespace Kooch.Api.Entities;

// One immutable funding plan per checkout key; the hold belongs to this attempt, not the session.
public sealed class BookingFundingAttempt : BaseEntity
{
    public int BookingSessionId { get; set; }
    public int WalletHoldId { get; set; }
    public int? PaymentId { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string Currency { get; set; } = string.Empty;
    public DateTime? AppliedAtUtc { get; set; }
    public WalletHold WalletHold { get; set; } = null!;
    public Payment? Payment { get; set; }
    public ICollection<BookingFundingItem> Items { get; set; } = [];
}

public sealed class BookingFundingItem : BaseEntity
{
    public int BookingFundingAttemptId { get; set; }
    public int ReservationId { get; set; }
    public decimal GuestPayable { get; set; }
    public decimal WalletAmount { get; set; }
    public BookingFundingAttempt BookingFundingAttempt { get; set; } = null!;
}
