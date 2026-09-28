namespace Kooch.Api.Entities;

// A finalized cancellation allocation, not evidence that guest funds were returned.
public class CancellationFinancialResolution : BaseEntity
{
    public int ReservationId { get; set; }
    public int PaymentId { get; set; }
    public int? PaymentItemId { get; set; }
    public int PropertyId { get; set; }
    public int ReservationFinancialSnapshotId { get; set; }
    public int OriginalPropertyPayableEntryId { get; set; }
    public decimal GrossPaidAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public decimal GuestRefundAmount { get; set; }
    public decimal FinalPropertyShare { get; set; }
    public decimal FinalKoochShare { get; set; }
    public CancellationFinancialResolutionMode Mode { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? Note { get; set; }
    public int ResolvedByUserId { get; set; }
    public DateTime ResolvedAtUtc { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string RequestFingerprint { get; set; } = string.Empty;

    // Later orchestration must supply posting links at insert, never patch history afterward.
    public int? ReversalFinancialEntryId { get; set; }
    public int? ReplacementPropertyPayableEntryId { get; set; }
    public int? ReleasedSettlementId { get; set; }
}
