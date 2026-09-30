namespace Kooch.Api.Entities;

public enum WalletSourceType
{
    CashReceived = 0,
    PromotionalCredit = 1
}

public sealed class WalletLot : BaseEntity
{
    public int WalletAccountId { get; set; }
    public WalletSourceType SourceType { get; set; }
    public bool IsWithdrawable { get; set; }
    public DateTime? ExpiresAtUtc { get; set; }
    public string? SourceReference { get; set; }
    public string? Reason { get; set; }
    public WalletAccount WalletAccount { get; set; } = null!;
}
