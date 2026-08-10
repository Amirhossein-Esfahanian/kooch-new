namespace Kooch.Api.Services;

internal sealed class ReservationApprovalReminderHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<ReservationApprovalReminderHostedService> logger) : BackgroundService
{
    internal const int BatchSize = 100;
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunOnceAsync(stoppingToken);
            await Task.Delay(Interval, timeProvider, stoppingToken);
        }
    }

    internal async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var reminderService = scope.ServiceProvider
                .GetRequiredService<IReservationApprovalReminderService>();
            var reminderCount = await reminderService.ProcessDueAsync(
                timeProvider.GetUtcNow().UtcDateTime,
                BatchSize,
                cancellationToken);
            if (reminderCount > 0)
            {
                logger.LogInformation(
                    "Sent approval reminders for {ReservationCount} pending reservations.",
                    reminderCount);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Reservation approval reminder processing failed.");
        }
    }
}
