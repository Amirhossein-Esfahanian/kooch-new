using System.Globalization;
using System.Security.Cryptography;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class SettlementNumberGenerator(KoochDbContext context)
{
    public async Task<string> GenerateAsync(CancellationToken cancellationToken = default)
    {
        if (context.Database.IsSqlServer())
        {
            if (context.Database.CurrentTransaction is null)
                throw new InvalidOperationException("SQL Server settlement number allocation requires an active transaction.");
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock
                    @Resource = {"Kooch:SettlementNumber"},
                    @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
                IF @result < 0
                    THROW 51000, 'Could not acquire the settlement number allocation lock.', 1;
                """, cancellationToken);
        }

        var tracked = context.ChangeTracker.Entries<Settlement>()
            .Select(entry => entry.Entity.SettlementNumber).ToHashSet(StringComparer.Ordinal);
        for (var attempt = 0; attempt < 100; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = "S-" + NextNumber().ToString("D6", CultureInfo.InvariantCulture);
            if (tracked.Contains(candidate)) continue;
            if (!await context.Settlements.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(settlement => settlement.SettlementNumber == candidate, cancellationToken))
                return candidate;
        }
        throw new InvalidOperationException("Unable to allocate a unique settlement reference after 100 attempts.");
    }

    protected virtual int NextNumber() => RandomNumberGenerator.GetInt32(100_000, 1_000_000);
}
