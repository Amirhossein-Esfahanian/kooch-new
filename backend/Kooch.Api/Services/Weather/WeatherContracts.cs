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

public sealed class WeatherProviderException() : Exception("The weather provider request failed.");
