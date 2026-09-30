namespace Kooch.Api.Entities;

public sealed class WalletHoldAllocation : BaseEntity
{
    public int WalletHoldId { get; set; }
    public int WalletLotId { get; set; }
    public int WalletAccountId { get; set; }
    public decimal Amount { get; set; }
    public WalletHold WalletHold { get; set; } = null!;
    public WalletLot WalletLot { get; set; } = null!;
}
