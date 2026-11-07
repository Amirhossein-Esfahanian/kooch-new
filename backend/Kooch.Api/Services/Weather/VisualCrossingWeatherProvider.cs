using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Weather;

public sealed class VisualCrossingWeatherProvider(HttpClient client, IOptions<WeatherOptions> options,
    IWeatherApiKeySource apiKeySource, TimeProvider timeProvider) : IWeatherProvider
{
    private readonly WeatherOptions settings = options.Value;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(apiKeySource.GetKey());

    public async Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var key = apiKeySource.GetKey();
        if (!settings.IsValid() || string.IsNullOrWhiteSpace(key)) throw new WeatherProviderException();
        // The provider requires its key in the query. This client's HTTP logging is disabled in DI.
        var uri = new Uri("https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
            Uri.EscapeDataString(settings.Location) + $"/next{settings.ForecastDays}days?include=days&contentType=json" +
            "&elements=datetime,tempmin,tempmax,precipprob,conditions,icon" +
            "&unitGroup=" + settings.UnitGroup + "&lang=" + settings.Language + "&key=" + Uri.EscapeDataString(key));

        for (var attempt = 0; attempt <= settings.RetryCount; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    if (attempt < settings.RetryCount && (int)response.StatusCode >= 500)
                    {
                        await BackoffAsync(attempt, cancellationToken);
                        continue;
                    }
                    throw new WeatherProviderException();
                }

                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[8192];
                int count;
                while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
                {
                    if (buffer.Length + count > 262144) throw new WeatherProviderException();
                    buffer.Write(chunk, 0, count);
                }
                buffer.Position = 0;
                using var document = await JsonDocument.ParseAsync(buffer, cancellationToken: timeout.Token);
                return Normalize(document.RootElement, key);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException)
            {
                if (attempt == settings.RetryCount) throw new WeatherProviderException();
                await BackoffAsync(attempt, cancellationToken);
            }
            catch (Exception exception) when (exception is JsonException or InvalidOperationException or FormatException or KeyNotFoundException or OverflowException)
            {
                throw new WeatherProviderException();
            }
        }
        throw new WeatherProviderException();
    }

    private Task BackoffAsync(int attempt, CancellationToken cancellationToken) =>
        Task.Delay(TimeSpan.FromSeconds(1 << attempt), timeProvider, cancellationToken);

    private WeatherSnapshot Normalize(JsonElement root, string apiKey)
    {
        var days = root.GetProperty("days").EnumerateArray().Select(day => new WeatherDay(
            DateOnly.ParseExact(day.GetProperty("datetime").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            day.GetProperty("tempmin").GetDecimal(), day.GetProperty("tempmax").GetDecimal(),
            day.GetProperty("precipprob").GetDecimal(), day.GetProperty("conditions").GetString()!,
            day.GetProperty("icon").GetString()!)).ToArray();
        var snapshot = new WeatherSnapshot(settings.LocationKey, settings.UnitGroup, settings.Language, days);
        if (!WeatherSnapshotValidation.IsValid(snapshot, settings) ||
            days.Any(day => day.Conditions.Contains(apiKey, StringComparison.Ordinal) || day.Icon.Contains(apiKey, StringComparison.Ordinal)))
            throw new WeatherProviderException();
        return snapshot;
    }
}

internal static class WeatherSnapshotValidation
{
    internal static bool IsValid(WeatherSnapshot? snapshot, WeatherOptions settings) =>
        snapshot is not null && snapshot.LocationKey == settings.LocationKey && snapshot.UnitGroup == settings.UnitGroup &&
        snapshot.Language == settings.Language && snapshot.Days is { Length: > 0 and <= 15 } &&
        snapshot.Days.Length == settings.ForecastDays && snapshot.Days.All(day => day is not null &&
            day.MinTemperature >= -100 && day.MaxTemperature <= 70 && day.MinTemperature <= day.MaxTemperature &&
            day.PrecipitationProbability is >= 0 and <= 100 && !string.IsNullOrWhiteSpace(day.Conditions) &&
            day.Conditions.Length <= 500 && !string.IsNullOrWhiteSpace(day.Icon) && day.Icon.Length <= 80 &&
            day.Icon.All(character => char.IsAsciiLetterLower(character) || character == '-')) &&
        snapshot.Days.Select((day, index) => day.Date.DayNumber == snapshot.Days[0].Date.DayNumber + index).All(valid => valid);
}
