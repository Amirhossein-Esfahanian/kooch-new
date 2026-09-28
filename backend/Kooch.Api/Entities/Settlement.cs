namespace Kooch.Api.Entities;

public enum SettlementStatus { Pending = 0, Due = 1, Overdue = 2, Paid = 3, Cancelled = 4 }

public class Settlement : BaseEntity
{
    public string SettlementNumber { get; set; } = string.Empty;
    public int PropertyId { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool IsEarlySettlement { get; set; }
    public DateTime? PaidAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }
    public int? CancelledByUserId { get; set; }
    public string? CancellationReason { get; set; }
    public Property Property { get; set; } = null!;
    public ICollection<SettlementItem> Items { get; set; } = [];

    // Due/overdue are calendar states, so they must not depend on a background job.
    public SettlementStatus GetStatus(DateOnly businessDate)
    {
        if (PaidAtUtc.HasValue) return SettlementStatus.Paid;
        if (CancelledAtUtc.HasValue) return SettlementStatus.Cancelled;
        var earliestDueDate = Items.Min(item => item.FinancialEntry.PayableDueDate
            ?? throw new InvalidOperationException("Payable due date is missing."));
        return earliestDueDate > businessDate ? SettlementStatus.Pending
            : earliestDueDate == businessDate ? SettlementStatus.Due : SettlementStatus.Overdue;
    }
}

public class SettlementItem : BaseEntity
{
    public int SettlementId { get; set; }
    public int FinancialEntryId { get; set; }
    public DateTime? ReleasedAtUtc { get; set; }
    public Settlement Settlement { get; set; } = null!;
    public FinancialEntry FinancialEntry { get; set; } = null!;
}
