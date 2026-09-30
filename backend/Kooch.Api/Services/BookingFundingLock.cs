using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class BookingFundingLock
{
    // Existing reservation cancellation/expiry must acquire the same session boundary before
    // payment/reservation locks, so checkout and callback cannot lock these resources in reverse.
    public static async Task ForReservationAsync(KoochDbContext context, int reservationId, CancellationToken ct)
    {
        var sessionId = await context.Reservations.AsNoTracking().Where(r => r.Id == reservationId)
            .Select(r => r.BookingSessionId).SingleOrDefaultAsync(ct);
        if (!sessionId.HasValue) return;
        var query = context.Database.IsSqlServer()
            ? context.BookingSessions.FromSqlInterpolated($"SELECT * FROM BookingSessions WITH (UPDLOCK, HOLDLOCK) WHERE Id = {sessionId.Value}")
            : context.BookingSessions.Where(s => s.Id == sessionId.Value);
        await query.AsNoTracking().SingleAsync(ct);
    }
}
