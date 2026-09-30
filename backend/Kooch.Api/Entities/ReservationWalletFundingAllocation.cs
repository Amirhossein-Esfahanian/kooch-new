namespace Kooch.Api.Entities;

public sealed class ReservationWalletFundingAllocation : BaseEntity
{
    public int ReservationFinancialSnapshotId { get; set; }
    public int WalletHoldAllocationId { get; set; }
    public int WalletLotId { get; set; }
    public int WalletAccountId { get; set; }
    public decimal Amount { get; set; }
    public ReservationFinancialSnapshot ReservationFinancialSnapshot { get; set; } = null!;
    public WalletHoldAllocation WalletHoldAllocation { get; set; } = null!;
}
