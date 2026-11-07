using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Weather;

public sealed class WeatherRefreshHostedService(IServiceScopeFactory scopes, IOptions<WeatherOptions> options,
    TimeProvider timeProvider, ILogger<WeatherRefreshHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        var settings = options.Value;
        if (!settings.Enabled || !settings.IsValid())
        {
            logger.LogWarning("Weather background refresh is disabled or its configuration is invalid.");
            return;
        }
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(settings.StartupDelaySeconds), timeProvider, stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<WeatherService>().RefreshAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception)
                {
                    // Do not log upstream exception objects: request URLs can contain provider credentials.
                    logger.LogWarning("Weather background refresh failed; it will retry at the next scheduled interval.");
                }
                await Task.Delay(TimeSpan.FromMinutes(settings.RefreshMinutes), timeProvider, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
