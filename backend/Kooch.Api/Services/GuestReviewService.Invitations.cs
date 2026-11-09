using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReviewInvitationOptions
{
    public const string SectionName = "ReviewInvitations";
    // Enable only after the additive migration has been approved and applied.
    public bool PermanentOptOutEnabled { get; set; }
}

public sealed class ReviewInvitationPreferencesUnavailableException()
    : Exception("Review invitation preferences are not available until deployment setup is complete.");

public sealed partial class GuestReviewService
{
    private async Task<(bool Available, HashSet<int> Suppressed)> InvitationPreferencesAsync(
        int userId, int[] reservationIds, CancellationToken ct)
    {
        if (invitationOptions?.Value.PermanentOptOutEnabled != true) return (false, []);
        try
        {
            var ids = await context.ReviewInvitationSuppressions.AsNoTracking()
                .Where(row => row.UserId == userId && reservationIds.Contains(row.ReservationId))
                .Select(row => row.ReservationId).ToListAsync(ct);
            return (true, ids.ToHashSet());
        }
        catch (SqlException error) when (MissingInvitationTable(error)) { return (false, []); }
    }

    public async Task<ReviewInvitationPreferenceResponse> SuppressInvitationAsync(
        int userId, int reservationId, CancellationToken ct = default)
    {
        await EnsureUserAsync(userId, ct);
        if (invitationOptions?.Value.PermanentOptOutEnabled != true)
            throw new ReviewInvitationPreferencesUnavailableException();
        try
        {
            await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
                ? await context.Database.BeginTransactionAsync(ct) : null;
            // Same missing-row serialization boundary as review submission; no reservation is modified.
            var reservations = context.Database.IsSqlServer()
                ? context.Reservations.FromSqlInterpolated($"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
                : context.Reservations.AsQueryable();
            if (!await reservations.AsNoTracking().ForGuestUser(userId)
                .AnyAsync(r => r.Id == reservationId && !r.IsDeleted && !r.Property.IsDeleted, ct))
                throw new KeyNotFoundException("Reservation not found.");
            var preference = await context.ReviewInvitationSuppressions.IgnoreQueryFilters()
                .SingleOrDefaultAsync(row => row.UserId == userId && row.ReservationId == reservationId, ct);
            if (preference is null)
            {
                context.ReviewInvitationSuppressions.Add(new ReviewInvitationSuppression
                { UserId = userId, ReservationId = reservationId, CreatedByUserId = userId });
            }
            else if (preference.IsDeleted)
            {
                preference.IsDeleted = false; preference.DeletedAtUtc = null; preference.DeletedByUserId = null;
                preference.UpdatedByUserId = userId;
            }
            if (context.ChangeTracker.HasChanges()) await context.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return new(reservationId, true);
        }
        catch (SqlException error) when (MissingInvitationTable(error))
        { throw new ReviewInvitationPreferencesUnavailableException(); }
        catch (DbUpdateException error) when (error.InnerException is SqlException sql && MissingInvitationTable(sql))
        { throw new ReviewInvitationPreferencesUnavailableException(); }
    }

    private static bool MissingInvitationTable(SqlException error) => error.Number == 208 &&
        error.Message.Contains("ReviewInvitationSuppressions", StringComparison.OrdinalIgnoreCase);
}
