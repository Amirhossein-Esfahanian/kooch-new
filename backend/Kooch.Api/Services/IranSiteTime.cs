namespace Kooch.Api.Services;

internal static class IranSiteTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

    internal static DateTime ToUtc(DateOnly date, TimeOnly time)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(local, Zone);
    }

    private static TimeZoneInfo ResolveZone()
    {
        foreach (var id in new[] { "Asia/Tehran", "Iran Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        throw new InvalidOperationException("Iran site time zone is unavailable.");
    }
}
