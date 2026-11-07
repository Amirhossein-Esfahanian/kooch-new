using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Weather;

public sealed class WeatherService(WeatherForecastStore store, IWeatherProvider provider,
    IOptions<WeatherOptions> options, TimeProvider timeProvider, ILogger<WeatherService> logger)
{
    private readonly WeatherOptions settings = options.Value;

    public async Task<WeatherResponse> GetAsync(CancellationToken cancellationToken)
    {
        if (!settings.IsValid()) return Unavailable("configuration_required");
        try
        {
            var cache = await store.ReadAsync(settings.LocationKey, cancellationToken);
            var snapshot = cache is { IsDeleted: false } ? WeatherJson.Read(cache.NormalizedForecastJson, settings) : null;
            if (snapshot is null || cache?.FetchedAtUtc is null) return Unavailable("no_snapshot");
            var today = WeatherForecastWindow.Today(timeProvider);
            var days = WeatherForecastWindow.SelectToday(snapshot.Days, timeProvider, settings.DisplayDays);
            var fetchedAt = DateTime.SpecifyKind(cache.FetchedAtUtc.Value, DateTimeKind.Utc);
            if (days.Length == 0 || days[0].Date != today) return Unavailable("forecast_expired", fetchedAt);
            var fetchedDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(fetchedAt, IranSiteTime.BusinessTimeZone));
            var stale = fetchedDate < today || cache.FetchedAtUtc <= timeProvider.GetUtcNow().UtcDateTime.AddMinutes(-settings.RefreshMinutes);
            return new(stale ? "stale" : "available", null, settings.LocationKey, "VisualCrossing",
                "Weather data by Visual Crossing", settings.UnitGroup, fetchedAt, days);
        }
        catch (Exception exception) when (WeatherForecastStore.IsStorageError(exception))
        {
            var reason = WeatherForecastStore.IsMissingTable(exception) ? "setup_required" : "storage_unavailable";
            logger.LogWarning("Weather cache read unavailable: {Reason}.", reason);
            return Unavailable(reason);
        }
    }

    public async Task<string> RefreshAsync(CancellationToken cancellationToken)
    {
        if (!settings.Enabled) return "disabled";
        if (!settings.IsValid() || !provider.IsConfigured)
        {
            logger.LogWarning("Weather refresh requires valid configuration and Weather:VisualCrossing:ApiKey.");
            return "configuration_required";
        }
        try
        {
            var lease = await store.TryAcquireAsync(settings, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
            if (lease is null) return "not_due_or_leased";
            try
            {
                var snapshot = await provider.FetchAsync(cancellationToken);
                var failure = WeatherSnapshotValidation.GetFailure(snapshot, settings);
                if (failure is null && WeatherForecastWindow.SelectToday(snapshot.Days, timeProvider, settings.DisplayDays).Length == 0)
                    failure = WeatherValidationRule.CurrentDayCoverage;
                if (failure is not null)
                    throw new WeatherProviderException(WeatherProviderFailureKind.Validation, validationRule: failure);
                return await store.SaveAsync(lease, snapshot, timeProvider.GetUtcNow().UtcDateTime, cancellationToken)
                    ? "refreshed" : "lease_lost";
            }
            catch (WeatherProviderException exception)
            {
                await store.DeferAsync(lease, timeProvider.GetUtcNow().UtcDateTime, settings.RefreshMinutes, cancellationToken);
                logger.LogWarning("Weather provider refresh failed with category {FailureKind}, validation rule {ValidationRule} and HTTP status {HttpStatusCode}; the last successful snapshot was preserved.",
                    exception.FailureKind, exception.ValidationRule, exception.HttpStatusCode);
                return "provider_unavailable";
            }
        }
        catch (Exception exception) when (WeatherForecastStore.IsStorageError(exception))
        {
            var reason = WeatherForecastStore.IsMissingTable(exception) ? "setup_required" : "storage_unavailable";
            logger.LogWarning("Weather refresh unavailable: {Reason}. Review the pending weather cache migration when setup is required.", reason);
            return reason;
        }
    }

    private WeatherResponse Unavailable(string reason, DateTime? fetchedAt = null) => new("unavailable", reason,
        settings.LocationKey, "VisualCrossing", "Weather data by Visual Crossing", settings.UnitGroup, fetchedAt, []);
}
