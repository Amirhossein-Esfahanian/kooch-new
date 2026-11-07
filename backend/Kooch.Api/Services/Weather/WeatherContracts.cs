namespace Kooch.Api.Services.Weather;

public sealed record WeatherDay(DateOnly Date, decimal MinTemperature, decimal MaxTemperature,
    decimal PrecipitationProbability, string Conditions, string Icon);

public sealed record WeatherSnapshot(string LocationKey, string UnitGroup, string Language, WeatherDay[] Days);

public sealed record WeatherResponse(string Status, string? UnavailableReason, string LocationKey,
    string Provider, string Attribution, string UnitGroup, DateTime? FetchedAtUtc, WeatherDay[] Days);

public interface IWeatherProvider
{
    bool IsConfigured { get; }
    Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken);
}

public interface IWeatherApiKeySource
{
    string? GetKey();
}

public sealed class ConfigurationWeatherApiKeySource(IConfiguration configuration) : IWeatherApiKeySource
{
    public string? GetKey() => configuration["Weather:VisualCrossing:ApiKey"];
}

public enum WeatherProviderFailureKind
{
    Unknown,
    Configuration,
    Authentication,
    Http,
    NetworkOrTimeout,
    Parsing,
    Validation
}

public sealed class WeatherProviderException(
    WeatherProviderFailureKind failureKind = WeatherProviderFailureKind.Unknown,
    int? httpStatusCode = null,
    WeatherValidationRule? validationRule = null, int? actualDayCount = null,
    int? minimumDayCount = null, int? maximumDayCount = null) : Exception("The weather provider request failed.")
{
    public WeatherProviderFailureKind FailureKind { get; } = failureKind;
    public int? HttpStatusCode { get; } = httpStatusCode;
    public WeatherValidationRule? ValidationRule { get; } = validationRule;
    public int? ActualDayCount { get; } = actualDayCount;
    public int? MinimumDayCount { get; } = minimumDayCount;
    public int? MaximumDayCount { get; } = maximumDayCount;
}

public enum WeatherValidationRule
{
    SnapshotMissing,
    LocationMismatch,
    UnitGroupMismatch,
    LanguageMismatch,
    ForecastDayCount,
    DayMissing,
    TemperatureBounds,
    TemperatureOrder,
    PrecipitationProbability,
    ConditionsMissing,
    ConditionsLength,
    IconMissing,
    IconLength,
    IconFormat,
    DateSequence,
    SensitiveContent,
    StartDate,
    CurrentDayCoverage
}
