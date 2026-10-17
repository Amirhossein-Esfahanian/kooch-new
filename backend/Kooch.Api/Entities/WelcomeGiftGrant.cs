namespace Kooch.Api.Entities;

public sealed class WelcomeGiftGrant : BaseEntity
{
    public int CampaignId { get; set; }
    public int UserId { get; set; }
    public string NationalCodeSnapshot { get; set; } = string.Empty;
    public decimal AmountSnapshot { get; set; }
    public int ValidityDaysSnapshot { get; set; }
    public DateTime GrantedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public int WalletLotId { get; set; }
    public int WalletEntryId { get; set; }
    public WelcomeGiftCampaign Campaign { get; set; } = null!;
    public User User { get; set; } = null!;
    public WalletLot WalletLot { get; set; } = null!;
    public WalletEntry WalletEntry { get; set; } = null!;
}
