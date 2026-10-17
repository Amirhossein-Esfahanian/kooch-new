namespace Kooch.Api.Entities;

public sealed class WelcomeGiftCampaign : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public int MaxRecipients { get; set; }
    public int GrantedCount { get; set; }
    public int ValidityDays { get; set; }
    public bool IsActive { get; set; }
}
