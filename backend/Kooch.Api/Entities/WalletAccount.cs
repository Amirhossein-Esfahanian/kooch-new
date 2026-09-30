namespace Kooch.Api.Entities;

public sealed class WalletAccount : BaseEntity
{
    public int UserId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public byte[] RowVersion { get; set; } = [];
    public User User { get; set; } = null!;
}
