namespace Kooch.Api.Entities;

public enum SettlementPaymentMethod
{
    BankTransfer = 0,
    CardToCard = 1,
    Other = 2
}

public class SettlementPaymentRecord : BaseEntity
{
    public int SettlementId { get; set; }
    public SettlementPaymentMethod PaymentMethod { get; set; }
    public string ReferenceNumber { get; set; } = string.Empty;
    public DateTime PaidAtUtc { get; set; }
    public string? Note { get; set; }
    public int RecordedByUserId { get; set; }
    public DateTime RecordedAtUtc { get; set; }
    public Settlement Settlement { get; set; } = null!;
    public User RecordedByUser { get; set; } = null!;
}
