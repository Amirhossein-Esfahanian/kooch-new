namespace Kooch.Api.Entities;

public sealed class WalletWithdrawalAllocation : BaseEntity
{
    public int WalletWithdrawalRequestId { get; set; }
    public int WalletAccountId { get; set; }
    public int WalletLotId { get; set; }
    public decimal Amount { get; set; }
    public WalletWithdrawalRequest WalletWithdrawalRequest { get; set; } = null!;
    public WalletLot WalletLot { get; set; } = null!;
}
