using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public static class ReservationNumberPersistence
{
    public static async Task SaveWithReservationNumberRetryAsync(
        this IReservationNumberGenerator generator,
        KoochDbContext dbContext,
        CancellationToken cancellationToken = default)
    {
        const int saveLimit = 5;
        const string savepoint = "ReservationNumberAllocation";
        var reservations = dbContext.ChangeTracker.Entries<Reservation>()
            .Where(entry => entry.State == EntityState.Added)
            .Select(entry => entry.Entity).ToArray();
        var transaction = dbContext.Database.CurrentTransaction;
        var canRollback = transaction?.SupportsSavepoints == true;
        if (canRollback) await transaction!.CreateSavepointAsync(savepoint, cancellationToken);

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                if (canRollback) await transaction!.ReleaseSavepointAsync(savepoint, cancellationToken);
                return;
            }
            catch (DbUpdateException error) when (reservations.Length > 0 && IsNumberCollision(error))
            {
                // A failed batch may already have inserted a session/guest. Roll back the
                // entire save before retrying; never retry an unsafe transaction (e.g. MARS).
                if (!canRollback) throw;
                await transaction!.RollbackToSavepointAsync(savepoint, cancellationToken);
                if (attempt + 1 >= saveLimit)
                    throw new InvalidOperationException("Unable to persist a unique reservation reference after 5 attempts.", error);

                var numbers = await generator.GenerateBatchAsync(reservations.Length, cancellationToken: cancellationToken);
                for (var index = 0; index < reservations.Length; index++)
                    reservations[index].ReservationNumber = numbers[index];
            }
        }
    }

    private static bool IsNumberCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql &&
        sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("'IX_Reservations_ReservationNumber'", StringComparison.Ordinal));
}
