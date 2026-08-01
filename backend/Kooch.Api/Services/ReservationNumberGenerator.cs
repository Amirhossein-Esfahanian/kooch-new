using System.Collections.Concurrent;
using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationNumberGenerator(KoochDbContext dbContext) : IReservationNumberGenerator
{
    private const string Prefix = "KCH";
    private const int SequenceWidth = 6;
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> AllocationLocks = new();
    private static readonly ConcurrentDictionary<string, int> AllocatedHighWatermarks = new();

    public async Task<string> GenerateAsync(
        DateTime? nowUtc = null,
        CancellationToken cancellationToken = default)
    {
        var numbers = await GenerateBatchAsync(1, nowUtc, cancellationToken);
        return numbers[0];
    }

    public async Task<IReadOnlyList<string>> GenerateBatchAsync(
        int count,
        DateTime? nowUtc = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(count);

        var datePart = (nowUtc ?? DateTime.UtcNow).ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var prefix = $"{Prefix}-{datePart}-";
        var allocationLock = AllocationLocks.GetOrAdd(prefix, static _ => new SemaphoreSlim(1, 1));

        await allocationLock.WaitAsync(cancellationToken);
        try
        {
            await AcquireDatabaseAllocationLockAsync(prefix, cancellationToken);

            var existingNumbers = await dbContext.Reservations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(reservation =>
                    reservation.ReservationNumber != null &&
                    reservation.ReservationNumber.StartsWith(prefix))
                .Select(reservation => reservation.ReservationNumber!)
                .ToListAsync(cancellationToken);

            var highestPersistedSequence = existingNumbers
                .Select(number => TryParseSequence(number, prefix))
                .Where(sequence => sequence.HasValue)
                .Select(sequence => sequence!.Value)
                .DefaultIfEmpty(0)
                .Max();
            var highestAllocatedSequence = AllocatedHighWatermarks.GetOrAdd(prefix, 0);
            var firstSequence = checked(Math.Max(highestPersistedSequence, highestAllocatedSequence) + 1);
            var lastSequence = checked(firstSequence + count - 1);

            var numbers = Enumerable.Range(firstSequence, count)
                .Select(sequence =>
                    $"{prefix}{sequence.ToString($"D{SequenceWidth}", CultureInfo.InvariantCulture)}")
                .ToArray();
            AllocatedHighWatermarks[prefix] = lastSequence;
            return numbers;
        }
        finally
        {
            allocationLock.Release();
        }
    }

    private async Task AcquireDatabaseAllocationLockAsync(
        string prefix,
        CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsSqlServer())
        {
            return;
        }

        if (dbContext.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "SQL Server reservation number allocation requires an active transaction.");
        }

        var resource = $"Kooch:ReservationNumber:{prefix}";
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = {resource},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            IF @result < 0
                THROW 51000, 'Could not acquire the reservation number allocation lock.', 1;
            """,
            cancellationToken);
    }

    private static int? TryParseSequence(string reservationNumber, string prefix)
    {
        if (!reservationNumber.StartsWith(prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var sequencePart = reservationNumber[prefix.Length..];
        return int.TryParse(sequencePart, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence)
            ? sequence
            : null;
    }
}
