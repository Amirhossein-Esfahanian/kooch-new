using System.Globalization;

namespace Kooch.Api.Services.Holidays;

internal sealed class HolidayCalendarSolarYearResolver(
    TimeProvider timeProvider,
    ILogger<HolidayCalendarSolarYearResolver> logger)
{
    internal bool TryGetCurrentSolarYear(TimeZoneInfo iranTimeZone, out int solarYear)
    {
        try
        {
            var iranLocalTime = TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), iranTimeZone);
            solarYear = new PersianCalendar().GetYear(iranLocalTime.DateTime);
            return true;
        }
        catch (ArgumentOutOfRangeException exception)
        {
            logger.LogError(exception, "The current time could not be converted to a Solar Hijri year.");
            solarYear = default;
            return false;
        }
    }
}
