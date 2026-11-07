using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Weather;

public sealed class VisualCrossingWeatherProvider(HttpClient client, IOptions<WeatherOptions> options,
    IWeatherApiKeySource apiKeySource, TimeProvider timeProvider) : IWeatherProvider
{
    private readonly WeatherOptions settings = options.Value;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(apiKeySource.GetKey());

    public Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        FetchCoreAsync(settings.RetryCount, cancellationToken);

    public Task<WeatherSnapshot> FetchOnceAsync(CancellationToken cancellationToken) =>
        FetchCoreAsync(0, cancellationToken);

    private async Task<WeatherSnapshot> FetchCoreAsync(int retryCount, CancellationToken cancellationToken)
    {
        var key = apiKeySource.GetKey();
        if (!settings.IsValid() || string.IsNullOrWhiteSpace(key))
            throw new WeatherProviderException(WeatherProviderFailureKind.Configuration);
        var today = WeatherForecastWindow.Today(timeProvider);
        var range = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "/" +
            today.AddDays(settings.ForecastDays - 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        // The provider requires its key in the query. This client's HTTP logging is disabled in DI.
        var uri = new Uri("https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
            Uri.EscapeDataString(settings.Location) + "/" + range + "?include=days&contentType=json" +
            "&elements=datetime,tempmin,tempmax,precipprob,conditions,icon" +
            "&unitGroup=" + settings.UnitGroup + "&lang=" + settings.Language + "&key=" + Uri.EscapeDataString(key));

        for (var attempt = 0; attempt <= retryCount; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    if (attempt < retryCount && (int)response.StatusCode >= 500)
                    {
                        await BackoffAsync(attempt, cancellationToken);
                        continue;
                    }
                    throw new WeatherProviderException((int)response.StatusCode is 401 or 403
                        ? WeatherProviderFailureKind.Authentication : WeatherProviderFailureKind.Http, (int)response.StatusCode);
                }

                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[8192];
                int count;
                while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
                {
                    if (buffer.Length + count > 262144) throw new WeatherProviderException(WeatherProviderFailureKind.Parsing);
                    buffer.Write(chunk, 0, count);
                }
                buffer.Position = 0;
                using var document = await JsonDocument.ParseAsync(buffer, cancellationToken: timeout.Token);
                return Normalize(document.RootElement, key, today);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException)
            {
                if (attempt == retryCount) throw new WeatherProviderException(WeatherProviderFailureKind.NetworkOrTimeout);
                await BackoffAsync(attempt, cancellationToken);
            }
            catch (Exception exception) when (exception is JsonException or InvalidOperationException or FormatException or KeyNotFoundException or OverflowException)
            {
                throw new WeatherProviderException(WeatherProviderFailureKind.Parsing);
            }
        }
        throw new WeatherProviderException(WeatherProviderFailureKind.NetworkOrTimeout);
    }

    private Task BackoffAsync(int attempt, CancellationToken cancellationToken) =>
        Task.Delay(TimeSpan.FromSeconds(1 << attempt), timeProvider, cancellationToken);

    private WeatherSnapshot Normalize(JsonElement root, string apiKey, DateOnly requestedStart)
    {
        var days = root.GetProperty("days").EnumerateArray().Select(day => new WeatherDay(
            DateOnly.ParseExact(day.GetProperty("datetime").GetString()
                ?? throw new WeatherProviderException(WeatherProviderFailureKind.Parsing), "yyyy-MM-dd", CultureInfo.InvariantCulture),
            day.GetProperty("tempmin").GetDecimal(), day.GetProperty("tempmax").GetDecimal(),
            day.GetProperty("precipprob").GetDecimal(), day.GetProperty("conditions").GetString()!,
            day.GetProperty("icon").GetString()!)).ToArray();
        var snapshot = new WeatherSnapshot(settings.LocationKey, settings.UnitGroup, settings.Language, days);
        var failure = WeatherSnapshotValidation.GetFailure(snapshot, settings);
        if (failure is not null)
            throw new WeatherProviderException(WeatherProviderFailureKind.Validation, validationRule: failure,
                actualDayCount: days.Length, minimumDayCount: settings.DisplayDays, maximumDayCount: settings.ForecastDays);
        if (days[0].Date != requestedStart)
            throw new WeatherProviderException(WeatherProviderFailureKind.Validation, validationRule: WeatherValidationRule.StartDate);
        if (days.Any(day => day.Conditions.Contains(apiKey, StringComparison.Ordinal) || day.Icon.Contains(apiKey, StringComparison.Ordinal)))
            throw new WeatherProviderException(WeatherProviderFailureKind.Validation, validationRule: WeatherValidationRule.SensitiveContent);
        return snapshot;
    }
}

internal static class WeatherSnapshotValidation
{
    internal static bool IsValid(WeatherSnapshot? snapshot, WeatherOptions settings) =>
        GetFailure(snapshot, settings) is null;

    internal static WeatherValidationRule? GetFailure(WeatherSnapshot? snapshot, WeatherOptions settings)
    {
        if (snapshot is null) return WeatherValidationRule.SnapshotMissing;
        if (snapshot.LocationKey != settings.LocationKey) return WeatherValidationRule.LocationMismatch;
        if (snapshot.UnitGroup != settings.UnitGroup) return WeatherValidationRule.UnitGroupMismatch;
        if (snapshot.Language != settings.Language) return WeatherValidationRule.LanguageMismatch;
        if (snapshot.Days is not { Length: > 0 and <= 15 } || snapshot.Days.Length < settings.DisplayDays ||
            snapshot.Days.Length > settings.ForecastDays)
            return WeatherValidationRule.ForecastDayCount;
        foreach (var day in snapshot.Days)
        {
            if (day is null) return WeatherValidationRule.DayMissing;
            if (day.MinTemperature < -100 || day.MaxTemperature > 70) return WeatherValidationRule.TemperatureBounds;
            if (day.MinTemperature > day.MaxTemperature) return WeatherValidationRule.TemperatureOrder;
            if (day.PrecipitationProbability is < 0 or > 100) return WeatherValidationRule.PrecipitationProbability;
            if (string.IsNullOrWhiteSpace(day.Conditions)) return WeatherValidationRule.ConditionsMissing;
            if (day.Conditions.Length > 500) return WeatherValidationRule.ConditionsLength;
            if (string.IsNullOrWhiteSpace(day.Icon)) return WeatherValidationRule.IconMissing;
            if (day.Icon.Length > 80) return WeatherValidationRule.IconLength;
            if (!day.Icon.All(character => char.IsAsciiLetterLower(character) || character == '-'))
                return WeatherValidationRule.IconFormat;
        }
        if (!snapshot.Days.Select((day, index) => day.Date.DayNumber == snapshot.Days[0].Date.DayNumber + index).All(valid => valid))
            return WeatherValidationRule.DateSequence;
        return null;
    }
}
