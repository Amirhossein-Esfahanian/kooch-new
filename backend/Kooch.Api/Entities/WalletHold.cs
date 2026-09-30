namespace Kooch.Api.Entities;

public enum WalletHoldStatus
{
    Active = 0,
    Consumed = 1,
    Released = 2,
    Expired = 3
}

public sealed class WalletHold : BaseEntity
{
    public int WalletAccountId { get; set; }
    public decimal Amount { get; set; }
    public WalletHoldStatus Status { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? ConsumedAtUtc { get; set; }
    public DateTime? ReleasedAtUtc { get; set; }
    public DateTime? ExpiredAtUtc { get; set; }
    public WalletAccount WalletAccount { get; set; } = null!;
    public ICollection<WalletHoldAllocation> Allocations { get; set; } = [];
}
