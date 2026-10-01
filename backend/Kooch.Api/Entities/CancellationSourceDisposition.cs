namespace Kooch.Api.Entities;

// Immutable decisions against original funding; NotReturned is allocated to final shares/forfeiture.
public sealed class CancellationSourceDisposition : BaseEntity
{
    public int CancellationFinancialResolutionId { get; set; }
    public CancellationFinancialResolution Resolution { get; set; } = null!;
    public int? PaymentId { get; set; }
    public int? PaymentItemId { get; set; }
    public int? ReservationWalletFundingAllocationId { get; set; }
    public int? RestoreWalletEntryId { get; set; }
    public WalletEntry? RestoreWalletEntry { get; set; }
    public decimal FundedAmount { get; set; }
    public decimal CashRefundAmount { get; set; }
    public decimal WalletRestoreAmount { get; set; }
    public decimal NotReturnedAmount { get; set; }
}
