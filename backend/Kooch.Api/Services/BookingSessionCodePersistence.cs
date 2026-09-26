using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public static class BookingSessionCodePersistence
{
    public static async Task SaveWithSessionCodeRetryAsync(
        this IBookingSessionCodeGenerator generator,
        KoochDbContext dbContext,
        IReservationNumberGenerator reservationNumberGenerator,
        CancellationToken cancellationToken = default)
    {
        const int saveLimit = 5;
        const string savepoint = "BookingSessionCodeAllocation";
        var sessions = dbContext.ChangeTracker.Entries<BookingSession>()
            .Where(entry => entry.State == EntityState.Added)
            .Select(entry => entry.Entity).ToArray();
        var transaction = dbContext.Database.CurrentTransaction;
        var canRollback = transaction?.SupportsSavepoints == true;
        if (canRollback) await transaction!.CreateSavepointAsync(savepoint, cancellationToken);

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await reservationNumberGenerator.SaveWithReservationNumberRetryAsync(dbContext, cancellationToken);
                if (canRollback) await transaction!.ReleaseSavepointAsync(savepoint, cancellationToken);
                return;
            }
            catch (DbUpdateException error) when (sessions.Length > 0 && IsCodeCollision(error))
            {
                // Retry only after rolling back the entire graph save, including any guest inserts.
                if (!canRollback) throw;
                await transaction!.RollbackToSavepointAsync(savepoint, cancellationToken);
                if (attempt + 1 >= saveLimit)
                    throw new InvalidOperationException("Unable to persist a unique order reference after 5 attempts.", error);

                foreach (var session in sessions)
                    session.SessionCode = await generator.GenerateAsync(cancellationToken);
            }
        }
    }

    private static bool IsCodeCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql &&
        sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("'IX_BookingSessions_SessionCode'", StringComparison.Ordinal));
}
