namespace Kooch.Api.Entities;

public class HolidayCalendarSyncState : BaseEntity
{
    public string ProviderName { get; set; } = string.Empty;
    public DateTime? LastAttemptAtUtc { get; set; }
    public DateTime? LastSuccessfulSyncAtUtc { get; set; }
    public int? LastSuccessfulSolarYearFrom { get; set; }
    public int? LastSuccessfulSolarYearTo { get; set; }
    public string? LastResponseHash { get; set; }
    public string? LastErrorSummary { get; set; }
    public string? LeaseOwner { get; set; }
    public DateTime? LeaseExpiresAtUtc { get; set; }
    public byte[] RowVersion { get; set; } = [];
}
