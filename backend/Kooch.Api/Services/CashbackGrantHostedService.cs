using Microsoft.Extensions.Options;

namespace Kooch.Api.Services;

internal sealed class CashbackGrantHostedService(
    CashbackGrantProcessor processor,
    IOptions<CashbackGrantProcessorOptions> options,
    TimeProvider timeProvider,
    ILogger<CashbackGrantHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Cashback Grant background processing is disabled.");
            return;
        }
        if (settings.IntervalMinutes is < 1 or > 1440 ||
            settings.BatchSize is < 1 or > CashbackGrantProcessor.MaximumBatchSize)
        {
            logger.LogError("Cashback Grant processor interval or batch size is invalid; processing is disabled.");
            return;
        }

        var interval = TimeSpan.FromMinutes(settings.IntervalMinutes);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Cashback Grant processing cycle failed.");
            }

            try
            {
                await Task.Delay(interval, timeProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    internal async Task<CashbackGrantBatchResult?> RunOnceAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.Enabled) return null;
        if (settings.IntervalMinutes is < 1 or > 1440 ||
            settings.BatchSize is < 1 or > CashbackGrantProcessor.MaximumBatchSize)
            throw new InvalidOperationException("Cashback Grant processor interval or batch size is invalid.");
        return await processor.ProcessDueBatchAsync(
            timeProvider.GetUtcNow().UtcDateTime, settings.BatchSize, cancellationToken);
    }
}
