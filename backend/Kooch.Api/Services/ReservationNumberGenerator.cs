using System.Globalization;
using System.Security.Cryptography;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationNumberGenerator(KoochDbContext dbContext) : IReservationNumberGenerator
{
    private const int CandidateLimit = 100;

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
        ArgumentOutOfRangeException.ThrowIfGreaterThan(count, 900_000);
        await AcquireDatabaseAllocationLockAsync(cancellationToken);

        var reserved = dbContext.ChangeTracker.Entries<Reservation>()
            .Select(entry => entry.Entity.ReservationNumber)
            .Where(number => number is not null)
            .ToHashSet(StringComparer.Ordinal);
        var numbers = new List<string>(count);
        for (var index = 0; index < count; index++)
        {
            string? available = null;
            for (var attempt = 0; attempt < CandidateLimit; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var candidate = "R-" + NextNumber().ToString("D6", CultureInfo.InvariantCulture);
                if (!reserved.Add(candidate)) continue;
                if (await dbContext.Reservations.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(reservation => reservation.ReservationNumber == candidate, cancellationToken)) continue;
                available = candidate;
                break;
            }

            if (available is null)
                throw new InvalidOperationException("Unable to allocate a unique reservation reference after 100 attempts.");
            numbers.Add(available);
        }

        return numbers;
    }

    protected virtual int NextNumber() => RandomNumberGenerator.GetInt32(100_000, 1_000_000);

    private async Task AcquireDatabaseAllocationLockAsync(CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsSqlServer()) return;
        if (dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("SQL Server reservation number allocation requires an active transaction.");

        // Keep allocation serialized until commit, as in the existing creation flows.
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = {"Kooch:ReservationNumber"},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            IF @result < 0
                THROW 51000, 'Could not acquire the reservation number allocation lock.', 1;
            """, cancellationToken);
    }
}
