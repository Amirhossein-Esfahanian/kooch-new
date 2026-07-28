using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Holidays;

internal sealed class HolidayCalendarSyncHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<HolidayCalendarSynchronizationOptions> options,
    TimeProvider timeProvider,
    HolidayCalendarSolarYearResolver solarYearResolver,
    ILogger<HolidayCalendarSyncHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();

        var synchronizationOptions = options.Value;
        if (!synchronizationOptions.Enabled)
        {
            logger.LogInformation("Holiday calendar synchronization is disabled.");
            await WaitForShutdownAsync(stoppingToken);
            return;
        }

        if (!HolidayCalendarSyncSchedule.TryValidateOptions(synchronizationOptions, out var validationError))
        {
            logger.LogError("Holiday calendar synchronization scheduling is disabled: {ErrorSummary}", validationError);
            await WaitForShutdownAsync(stoppingToken);
            return;
        }

        if (!HolidayCalendarSyncSchedule.TryResolveIranTimeZone(
                synchronizationOptions.IranTimeZoneId,
                out var iranTimeZone))
        {
            logger.LogError("Holiday calendar synchronization was skipped because the configured Iran timezone is invalid.");
            await WaitForShutdownAsync(stoppingToken);
            return;
        }

        if (synchronizationOptions.RunOnStartup)
        {
            await DelayAsync(TimeSpan.FromSeconds(synchronizationOptions.StartupDelaySeconds), stoppingToken);
            await RunOnceAsync(synchronizationOptions, iranTimeZone!, stoppingToken);
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var nextRunUtc = HolidayCalendarSyncSchedule.GetNextRunUtc(
                timeProvider.GetUtcNow(),
                iranTimeZone!,
                synchronizationOptions.SyncDayOfMonth,
                synchronizationOptions.SyncHourLocal,
                synchronizationOptions.SyncMinuteLocal);
            await DelayAsync(nextRunUtc - timeProvider.GetUtcNow(), stoppingToken);
            await RunOnceAsync(synchronizationOptions, iranTimeZone!, stoppingToken);
        }
    }

    private async Task RunOnceAsync(
        HolidayCalendarSynchronizationOptions synchronizationOptions,
        TimeZoneInfo iranTimeZone,
        CancellationToken stoppingToken)
    {
        if (!solarYearResolver.TryGetCurrentSolarYear(iranTimeZone, out var currentSolarYear))
        {
            return;
        }

        try
        {
            using var scope = scopeFactory.CreateScope();
            var synchronizationService = scope.ServiceProvider
                .GetRequiredService<IHolidayCalendarSynchronizationService>();
            var result = await synchronizationService.SyncWindowAsync(
                currentSolarYear,
                synchronizationOptions.InitialYearsAhead,
                stoppingToken);
            if (!result.Succeeded)
            {
                logger.LogWarning(
                    "Holiday calendar synchronization completed unsuccessfully with category {FailureCategory}.",
                    result.FailureCategory);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unexpected holiday calendar synchronization failure.");
        }
    }

    private Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        return delay <= TimeSpan.Zero
            ? Task.CompletedTask
            : Task.Delay(delay, timeProvider, cancellationToken);
    }

    private Task WaitForShutdownAsync(CancellationToken cancellationToken) =>
        Task.Delay(Timeout.InfiniteTimeSpan, timeProvider, cancellationToken);
}
