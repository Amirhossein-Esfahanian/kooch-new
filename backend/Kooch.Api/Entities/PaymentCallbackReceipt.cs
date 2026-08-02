namespace Kooch.Api.Entities;

public class PaymentCallbackReceipt : BaseEntity
{
    public int PaymentId { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string ProviderEventId { get; set; } = string.Empty;
    public string TransactionReference { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool IsSuccessful { get; set; }
    public DateTime ReceivedAtUtc { get; set; }

    public Payment Payment { get; set; } = null!;
}
