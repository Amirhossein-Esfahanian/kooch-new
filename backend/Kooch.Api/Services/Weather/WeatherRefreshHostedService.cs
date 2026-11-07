using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Weather;

public sealed class WeatherRefreshHostedService(IServiceScopeFactory scopes, IOptions<WeatherOptions> options,
    TimeProvider timeProvider, ILogger<WeatherRefreshHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Weather background refresh is disabled by Weather:Enabled.");
            return;
        }
        if (!settings.IsValid())
        {
            logger.LogWarning("Weather background refresh configuration is invalid.");
            return;
        }
        try
        {
            logger.LogInformation("Weather refresh worker enabled: poll {PollMinutes} minutes, successful refresh {RefreshMinutes} minutes, failure retry {FailureRetryMinutes} minutes.",
                settings.PollMinutes, settings.RefreshMinutes, settings.FailureRetryMinutes);
            await Task.Delay(TimeSpan.FromSeconds(settings.StartupDelaySeconds), timeProvider, stoppingToken);
            string? previousOutcome = null;
            while (!stoppingToken.IsCancellationRequested)
            {
                var delayMinutes = settings.PollMinutes;
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var outcome = await scope.ServiceProvider.GetRequiredService<WeatherService>().RefreshAsync(stoppingToken);
                    if (outcome != previousOutcome) logger.LogInformation("Weather refresh check outcome: {Outcome}.", outcome);
                    previousOutcome = outcome;
                    if (outcome is "configuration_required" or "setup_required" or "storage_unavailable")
                        delayMinutes = settings.FailureRetryMinutes;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception)
                {
                    // Do not log upstream exception objects: request URLs can contain provider credentials.
                    logger.LogWarning("Weather background refresh failed with category Unexpected; next check in {FailureRetryMinutes} minutes.",
                        settings.FailureRetryMinutes);
                    delayMinutes = settings.FailureRetryMinutes;
                }
                await Task.Delay(TimeSpan.FromMinutes(delayMinutes), timeProvider, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
