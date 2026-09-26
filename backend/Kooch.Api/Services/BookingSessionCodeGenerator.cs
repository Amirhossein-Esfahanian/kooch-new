using System.Globalization;
using System.Security.Cryptography;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class BookingSessionCodeGenerator(KoochDbContext dbContext) : IBookingSessionCodeGenerator
{
    private const int CandidateLimit = 100;

    public async Task<string> GenerateAsync(CancellationToken cancellationToken = default)
    {
        await AcquireDatabaseAllocationLockAsync(cancellationToken);
        var reserved = dbContext.ChangeTracker.Entries<BookingSession>()
            .Select(entry => entry.Entity.SessionCode)
            .ToHashSet(StringComparer.Ordinal);

        for (var attempt = 0; attempt < CandidateLimit; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = "O-" + NextNumber().ToString("D6", CultureInfo.InvariantCulture);
            if (!reserved.Add(candidate)) continue;
            if (!await dbContext.BookingSessions.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(session => session.SessionCode == candidate, cancellationToken))
                return candidate;
        }

        throw new InvalidOperationException("Unable to allocate a unique order reference after 100 attempts.");
    }

    protected virtual int NextNumber() => RandomNumberGenerator.GetInt32(100_000, 1_000_000);

    private async Task AcquireDatabaseAllocationLockAsync(CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsSqlServer()) return;
        if (dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("SQL Server order reference allocation requires an active transaction.");

        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = {"Kooch:BookingSessionCode"},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            IF @result < 0
                THROW 51000, 'Could not acquire the order reference allocation lock.', 1;
            """, cancellationToken);
    }
}
