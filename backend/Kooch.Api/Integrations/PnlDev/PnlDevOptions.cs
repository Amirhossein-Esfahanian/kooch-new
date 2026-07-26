namespace Kooch.Api.Integrations.PnlDev;

public sealed class PnlDevOptions
{
    public const string SectionName = "HolidayProviders:PnlDev";

    public string BaseUrl { get; set; } = "https://pnldev.com/api/calender";
    public int RequestTimeoutSeconds { get; set; } = 30;
    public bool Enabled { get; set; }
}
