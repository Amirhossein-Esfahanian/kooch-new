namespace Kooch.Api.Services;

internal sealed class ReservationExpirationHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<ReservationExpirationHostedService> logger) : BackgroundService
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
            var reservationService = scope.ServiceProvider
                .GetRequiredService<IReservationService>();
            var expiredCount = await reservationService
                .ExpirePendingApprovalReservationsAsync(BatchSize, cancellationToken);
            if (expiredCount > 0)
            {
                logger.LogInformation(
                    "Automatically rejected {ReservationCount} reservations after their owner approval window expired.",
                    expiredCount);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Reservation owner approval expiration processing failed.");
        }
    }
}
