using System.Security;

namespace Kooch.Api.Services.Holidays;

internal static class HolidayCalendarSyncSchedule
{
    internal const string WindowsIranTimeZoneId = "Iran Standard Time";
    internal const string LinuxIranTimeZoneId = "Asia/Tehran";

    internal static bool TryValidateOptions(
        HolidayCalendarSynchronizationOptions options,
        out string errorSummary)
    {
        if (options.InitialYearsAhead is < 0 or > 10)
        {
            errorSummary = "InitialYearsAhead must be between 0 and 10.";
            return false;
        }

        if (options.StartupDelaySeconds is < 0 or > 86400)
        {
            errorSummary = "StartupDelaySeconds must be between 0 and 86400.";
            return false;
        }

        if (options.SyncDayOfMonth is < 1 or > 31 ||
            options.SyncHourLocal is < 0 or > 23 ||
            options.SyncMinuteLocal is < 0 or > 59)
        {
            errorSummary = "The monthly holiday synchronization schedule is invalid.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(options.IranTimeZoneId))
        {
            errorSummary = "IranTimeZoneId is required.";
            return false;
        }

        errorSummary = string.Empty;
        return true;
    }

    internal static bool TryResolveIranTimeZone(string configuredId, out TimeZoneInfo? timeZone)
    {
        timeZone = null;
        if (string.IsNullOrWhiteSpace(configuredId))
        {
            return false;
        }

        var trimmedId = configuredId.Trim();
        var recognizedIranId = string.Equals(trimmedId, WindowsIranTimeZoneId, StringComparison.OrdinalIgnoreCase) ||
                               string.Equals(trimmedId, LinuxIranTimeZoneId, StringComparison.OrdinalIgnoreCase);
        var candidateIds = recognizedIranId
            ? new[] { trimmedId, WindowsIranTimeZoneId, LinuxIranTimeZoneId }
            : new[] { trimmedId };

        foreach (var candidateId in candidateIds.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                timeZone = TimeZoneInfo.FindSystemTimeZoneById(candidateId);
                return true;
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
            catch (SecurityException)
            {
            }
        }

        return false;
    }

    internal static DateTimeOffset GetNextRunUtc(
        DateTimeOffset utcNow,
        TimeZoneInfo iranTimeZone,
        int dayOfMonth,
        int hourLocal,
        int minuteLocal)
    {
        var localNow = TimeZoneInfo.ConvertTime(utcNow, iranTimeZone).DateTime;
        var scheduledLocal = CreateScheduledLocal(
            localNow.Year,
            localNow.Month,
            dayOfMonth,
            hourLocal,
            minuteLocal);

        if (scheduledLocal <= localNow)
        {
            var nextMonth = new DateTime(localNow.Year, localNow.Month, 1).AddMonths(1);
            scheduledLocal = CreateScheduledLocal(
                nextMonth.Year,
                nextMonth.Month,
                dayOfMonth,
                hourLocal,
                minuteLocal);
        }

        return ConvertLocalToUtc(scheduledLocal, iranTimeZone);
    }

    private static DateTime CreateScheduledLocal(
        int year,
        int month,
        int requestedDay,
        int hour,
        int minute)
    {
        var day = Math.Min(requestedDay, DateTime.DaysInMonth(year, month));
        return new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Unspecified);
    }

    private static DateTimeOffset ConvertLocalToUtc(DateTime localTime, TimeZoneInfo timeZone)
    {
        while (timeZone.IsInvalidTime(localTime))
        {
            localTime = localTime.AddMinutes(1);
        }

        var offset = timeZone.IsAmbiguousTime(localTime)
            ? timeZone.GetAmbiguousTimeOffsets(localTime).Max()
            : timeZone.GetUtcOffset(localTime);
        return new DateTimeOffset(localTime, offset).ToUniversalTime();
    }
}
