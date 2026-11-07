namespace Kooch.Api.Services.Weather;

internal static class WeatherForecastWindow
{
    internal static DateOnly Today(TimeProvider clock) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone).DateTime);

    internal static WeatherDay[] SelectToday(WeatherDay[] days, TimeProvider clock, int count)
    {
        var today = Today(clock);
        var selected = days.Where(day => day.Date >= today).Take(count).ToArray();
        return selected.Length == count && selected.Select((day, index) => day.Date == today.AddDays(index)).All(valid => valid)
            ? selected : [];
    }
}
