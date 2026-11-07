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
