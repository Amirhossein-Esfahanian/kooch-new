namespace Kooch.Api.Entities;

public class PasswordSetupToken : BaseEntity
{
    public int UserId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UsedAtUtc { get; set; }

    public User User { get; set; } = null!;
}
