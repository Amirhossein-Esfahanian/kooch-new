namespace Kooch.Api.Services.Weather;

public sealed class WeatherOptions
{
    public const string SectionName = "Weather";
    public bool Enabled { get; set; } = false;
    public string Provider { get; set; } = "VisualCrossing";
    public string LocationKey { get; set; } = "kashan";
    public string Location { get; set; } = "Kashan,Iran";
    public int ForecastDays { get; set; } = 15;
    public int DisplayDays { get; set; } = 7;
    public string UnitGroup { get; set; } = "metric";
    public string Language { get; set; } = "fa";
    public int RefreshMinutes { get; set; } = 180;
    public int TimeoutSeconds { get; set; } = 15;
    public int RetryCount { get; set; } = 2;
    public int LeaseSeconds { get; set; } = 120;
    public int StartupDelaySeconds { get; set; } = 10;

    public bool IsValid() => Provider == "VisualCrossing" &&
        !string.IsNullOrWhiteSpace(LocationKey) && LocationKey.Length <= 200 &&
        !string.IsNullOrWhiteSpace(Location) && Location.Length <= 200 &&
        ForecastDays is >= 1 and <= 15 && DisplayDays >= 1 && DisplayDays <= ForecastDays &&
        UnitGroup is "metric" or "us" or "uk" && Language is "fa" or "en" &&
        RefreshMinutes is >= 30 and <= 1440 && TimeoutSeconds is >= 1 and <= 30 &&
        RetryCount is >= 0 and <= 2 && LeaseSeconds >= (RetryCount + 1) * TimeoutSeconds + 15 &&
        LeaseSeconds <= 300 && StartupDelaySeconds is >= 0 and <= 300;
}
