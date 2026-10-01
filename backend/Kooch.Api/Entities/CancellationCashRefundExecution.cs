namespace Kooch.Api.Entities;

// Execution of the resolution's entire cash entitlement. Its immutable source breakdown is
// the CashRefundAmount on that resolution's CancellationSourceDispositions, not a fake Payment.
public sealed class CancellationCashRefundExecution : BaseEntity
{
    public int CancellationFinancialResolutionId { get; set; }
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
