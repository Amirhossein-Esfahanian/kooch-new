namespace Kooch.Api.Entities;

public class FinancialEntry : BaseEntity
{
    public int PropertyId { get; set; }
    public int? ReservationId { get; set; }
    public int? PaymentId { get; set; }
    public int? PaymentItemId { get; set; }
    public FinancialEntryType EntryType { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public DateTime EffectiveAtUtc { get; set; }
    public string CorrelationKey { get; set; } = string.Empty;
    public int? ReversesEntryId { get; set; }
    public string? Reason { get; set; }

    public Property Property { get; set; } = null!;
    public Reservation? Reservation { get; set; }
    public Payment? Payment { get; set; }
    public PaymentItem? PaymentItem { get; set; }
    public FinancialEntry? ReversesEntry { get; set; }
    public ICollection<FinancialEntry> ReversalEntries { get; set; } = [];
}
