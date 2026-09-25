using System.Globalization;
using System.Security.Cryptography;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class VoucherNumberGenerator(KoochDbContext dbContext) : IVoucherNumberGenerator
{
    private const int CandidateLimit = 100;

    public async Task<string> GenerateAsync(CancellationToken cancellationToken = default)
    {
        await AcquireDatabaseAllocationLockAsync(cancellationToken);
        var reserved = dbContext.ChangeTracker.Entries<ReservationVoucher>()
            .Select(entry => entry.Entity.VoucherNumber)
            .Where(number => !string.IsNullOrWhiteSpace(number))
            .ToHashSet(StringComparer.Ordinal);

        for (var attempt = 0; attempt < CandidateLimit; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = "V-" + NextNumber().ToString("D6", CultureInfo.InvariantCulture);
            if (!reserved.Add(candidate))
            {
                continue;
            }

            var exists = await dbContext.ReservationVouchers
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(voucher => voucher.VoucherNumber == candidate, cancellationToken);
            if (!exists)
            {
                return candidate;
            }
        }

        throw new InvalidOperationException(
            "Unable to allocate a unique voucher number after 100 attempts.");
    }

    protected virtual int NextNumber() => RandomNumberGenerator.GetInt32(100_000, 1_000_000);

    private async Task AcquireDatabaseAllocationLockAsync(CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsSqlServer())
        {
            return;
        }

        if (dbContext.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "SQL Server voucher number allocation requires an active transaction.");
        }

        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = {"Kooch:VoucherNumber"},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            IF @result < 0
                THROW 51000, 'Could not acquire the voucher number allocation lock.', 1;
            """,
            cancellationToken);
    }
}
