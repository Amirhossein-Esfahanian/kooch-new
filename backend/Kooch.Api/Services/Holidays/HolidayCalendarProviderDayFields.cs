using Kooch.Api.Entities;

namespace Kooch.Api.Services.Holidays;

internal readonly record struct HolidayCalendarProviderDayFields(
    int SolarYear,
    int SolarMonth,
    int SolarDay,
    DayOfWeek DayOfWeek,
    bool IsWeeklyHoliday,
    bool IsOfficialHoliday,
    string ProviderName,
    int SourceSolarYear,
    DateTime LastProviderSyncAtUtc)
{
    internal static HolidayCalendarProviderDayFields FromSnapshot(
        HolidayCalendarNormalizedDay day,
        string providerName,
        DateTime syncedAtUtc) => new(
        day.SolarYear,
        day.SolarMonth,
        day.SolarDay,
        day.DayOfWeek,
        day.IsWeeklyHoliday,
        day.IsOfficialHoliday,
        providerName,
        day.SourceSolarYear,
        syncedAtUtc);

    internal bool HasSemanticChanges(HolidayCalendarDay day) =>
        day.SolarYear != SolarYear ||
        day.SolarMonth != SolarMonth ||
        day.SolarDay != SolarDay ||
        day.DayOfWeek != DayOfWeek ||
        day.IsWeeklyHoliday != IsWeeklyHoliday ||
        day.IsOfficialHoliday != IsOfficialHoliday ||
        !string.Equals(day.ProviderName, ProviderName, StringComparison.Ordinal) ||
        day.SourceSolarYear != SourceSolarYear;

    internal void ApplyTo(HolidayCalendarDay day)
    {
        day.SolarYear = SolarYear;
        day.SolarMonth = SolarMonth;
        day.SolarDay = SolarDay;
        day.DayOfWeek = DayOfWeek;
        day.IsWeeklyHoliday = IsWeeklyHoliday;
        day.IsOfficialHoliday = IsOfficialHoliday;
        day.ProviderName = ProviderName;
        day.SourceSolarYear = SourceSolarYear;
        day.LastProviderSyncAtUtc = LastProviderSyncAtUtc;
    }
}
