namespace Kooch.Api.Entities;

// The external return of guest funds; the ledger reversal is a separate property obligation.
public class RefundRecord : BaseEntity
{
    public int PaymentId { get; set; }
    public int? PaymentItemId { get; set; }
    public int ReservationId { get; set; }
    public int PropertyId { get; set; }
    public int? ReservationFinancialSnapshotId { get; set; }
    public int? OriginalPropertyPayableEntryId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public DateTime RefundedAtUtc { get; set; }
    public string ReferenceNumber { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string? Note { get; set; }
    public int RecordedByUserId { get; set; }
    public DateTime RecordedAtUtc { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string RequestFingerprint { get; set; } = string.Empty;
}
