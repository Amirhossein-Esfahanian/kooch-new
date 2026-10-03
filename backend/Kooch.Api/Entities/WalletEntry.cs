namespace Kooch.Api.Entities;

public enum WalletEntryDirection
{
    Credit = 0,
    Debit = 1
}

public sealed class WalletEntry : BaseEntity
{
    public int WalletAccountId { get; set; }
    public int WalletLotId { get; set; }
    public int? WalletWithdrawalAllocationId { get; set; }
    public WalletEntryDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public WalletAccount WalletAccount { get; set; } = null!;
    public WalletLot WalletLot { get; set; } = null!;
    public WalletWithdrawalAllocation? WalletWithdrawalAllocation { get; set; }
}
