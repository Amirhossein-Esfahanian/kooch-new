namespace Kooch.Api.Entities;

public enum WalletWithdrawalStatus
{
    Pending = 0,
    Approved = 1,
    Paid = 2,
    Rejected = 3,
    Cancelled = 4
}

public sealed class WalletWithdrawalRequest : BaseEntity
{
    public int WalletAccountId { get; set; }
    public decimal Amount { get; set; }
    public WalletWithdrawalStatus Status { get; set; }
    public DateTime RequestedAtUtc { get; set; }
    public WalletAccount WalletAccount { get; set; } = null!;
    public ICollection<WalletWithdrawalAllocation> Allocations { get; set; } = [];
}
