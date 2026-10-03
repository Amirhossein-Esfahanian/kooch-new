using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal sealed record CashbackGrantBatchResult(int CandidateCount, int ProcessedCount, int SkippedCount,
    int FailedCount, bool QueryFailed = false);

internal sealed class CashbackGrantProcessor(
    IServiceScopeFactory scopeFactory,
    ILogger<CashbackGrantProcessor> logger)
{
    internal const int MaximumBatchSize = 1000;

    internal async Task<CashbackGrantBatchResult> ProcessDueBatchAsync(
        DateTime nowUtc, int batchSize, CancellationToken cancellationToken)
    {
        if (nowUtc.Kind != DateTimeKind.Utc || batchSize is < 1 or > MaximumBatchSize)
            throw new ArgumentException("Cashback processing requires a UTC time and bounded batch size.");

        int[] candidateIds;
        try
        {
            using var scope = scopeFactory.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            candidateIds = await context.ReservationCashbackEntitlements.AsNoTracking()
                .Where(row => row.Status == CashbackEntitlementStatus.Pending && row.EligibleAtUtc <= nowUtc)
                .OrderBy(row => row.EligibleAtUtc).ThenBy(row => row.Id)
                .Select(row => row.Id).Take(batchSize).ToArrayAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Cashback Grant candidate discovery failed.");
            return new CashbackGrantBatchResult(0, 0, 0, 0, QueryFailed: true);
        }

        var processed = 0;
        var skipped = 0;
        var failed = 0;
        foreach (var entitlementId in candidateIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                using var scope = scopeFactory.CreateScope();
                var grants = scope.ServiceProvider.GetRequiredService<IReservationCashbackEntitlementService>();
                await grants.GrantAsync(entitlementId, nowUtc, cancellationToken);
                processed++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (KeyNotFoundException)
            {
                skipped++;
                logger.LogDebug("Cashback entitlement {EntitlementId} disappeared before Grant.", entitlementId);
            }
            catch (InvalidOperationException exception) when (IsExpectedStateChange(exception))
            {
                skipped++;
                logger.LogDebug("Cashback entitlement {EntitlementId} no longer qualifies for Grant: {Reason}",
                    entitlementId, exception.Message);
            }
            catch (Exception exception)
            {
                failed++;
                logger.LogError(exception, "Cashback Grant failed for entitlement {EntitlementId}.", entitlementId);
            }
        }

        if (candidateIds.Length > 0)
            logger.LogInformation(
                "Cashback Grant batch found {CandidateCount} candidates; processed {ProcessedCount}, skipped {SkippedCount}, failed {FailedCount}.",
                candidateIds.Length, processed, skipped, failed);
        else
            logger.LogDebug("Cashback Grant batch found no due entitlements.");

        return new CashbackGrantBatchResult(candidateIds.Length, processed, skipped, failed);
    }

    private static bool IsExpectedStateChange(InvalidOperationException exception) => exception.Message is
        "Only an ungranted Pending Cashback entitlement can be granted." or
        "Cashback entitlement is not yet due." or
        "Cancelled reservations cannot receive Cashback.";
}
