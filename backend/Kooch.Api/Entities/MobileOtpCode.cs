namespace Kooch.Api.Entities;

public class MobileOtpCode : BaseEntity
{
    public int UserId { get; set; }
    public string Mobile { get; set; } = string.Empty;
    public string CodeHash { get; set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UsedAtUtc { get; set; }

    public User User { get; set; } = null!;
}
