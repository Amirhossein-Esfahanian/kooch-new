namespace Kooch.Api.Services.Holidays;

public sealed class HolidayCalendarSynchronizationOptions
{
    public const string SectionName = "HolidayCalendar:Synchronization";

    public bool Enabled { get; set; }
    public int InitialYearsAhead { get; set; } = 2;
    public string ProviderName { get; set; } = "PNLdev";
    public int MaximumEventTitleLength { get; set; } = 512;
}
