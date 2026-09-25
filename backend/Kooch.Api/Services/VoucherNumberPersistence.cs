using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public static class VoucherNumberPersistence
{
    public static async Task SaveWithVoucherNumberRetryAsync(
        this KoochDbContext dbContext,
        CancellationToken cancellationToken = default)
    {
        const int saveLimit = 5;
        const string savepoint = "VoucherNumberAllocation";
        var vouchers = dbContext.ChangeTracker.Entries<ReservationVoucher>()
            .Where(entry => entry.State == EntityState.Added)
            .Select(entry => entry.Entity)
            .ToArray();
        var transaction = dbContext.Database.CurrentTransaction;
        var canRollback = transaction?.SupportsSavepoints == true;
        if (canRollback)
        {
            await transaction!.CreateSavepointAsync(savepoint, cancellationToken);
        }

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                if (canRollback)
                {
                    await transaction!.ReleaseSavepointAsync(savepoint, cancellationToken);
                }

                return;
            }
            catch (DbUpdateException error) when (vouchers.Length > 0 && IsVoucherNumberCollision(error))
            {
                if (!canRollback)
                {
                    throw;
                }

                await transaction!.RollbackToSavepointAsync(savepoint, cancellationToken);
                if (attempt + 1 >= saveLimit)
                {
                    throw new InvalidOperationException(
                        "Unable to persist a unique voucher number after 5 attempts.",
                        error);
                }

                var generator = new VoucherNumberGenerator(dbContext);
                foreach (var voucher in vouchers)
                {
                    voucher.VoucherNumber = await generator.GenerateAsync(cancellationToken);
                }
            }
        }
    }

    private static bool IsVoucherNumberCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql &&
        sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("'IX_ReservationVouchers_VoucherNumber'", StringComparison.Ordinal));
}
