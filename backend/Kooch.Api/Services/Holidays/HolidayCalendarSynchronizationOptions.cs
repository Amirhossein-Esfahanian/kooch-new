namespace Kooch.Api.Services.Holidays;

public sealed class HolidayCalendarSynchronizationOptions
{
    public const string SectionName = "HolidayCalendar:Synchronization";

    public bool Enabled { get; set; }
    public int InitialYearsAhead { get; set; } = 2;
    public bool RunOnStartup { get; set; } = true;
    public int StartupDelaySeconds { get; set; } = 10;
    public int SyncDayOfMonth { get; set; } = 1;
    public int SyncHourLocal { get; set; } = 3;
    public int SyncMinuteLocal { get; set; }
    public string IranTimeZoneId { get; set; } = HolidayCalendarSyncSchedule.WindowsIranTimeZoneId;
    public string ProviderName { get; set; } = "PNLdev";
    public int MaximumEventTitleLength { get; set; } = 512;
}
