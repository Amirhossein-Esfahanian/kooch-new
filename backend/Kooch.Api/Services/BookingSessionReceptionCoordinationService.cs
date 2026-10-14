using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class BookingSessionReceptionCoordinationService(
    KoochDbContext dbContext,
    TimeProvider timeProvider)
{
    public async Task AcknowledgeAsync(
        int clientId,
        string sessionCode,
        CancellationToken cancellationToken = default)
    {
        if (clientId <= 0)
            throw new UnauthorizedAccessException("The authenticated user is invalid.");

        var normalizedCode = sessionCode?.Trim();
        if (string.IsNullOrEmpty(normalizedCode))
            throw new ArgumentException("Session code is required.", nameof(sessionCode));

        var ownedSession = dbContext.BookingSessions
            .Where(session => session.ClientId == clientId && session.SessionCode == normalizedCode);
        if (!await ownedSession.AnyAsync(cancellationToken))
            throw new KeyNotFoundException("Booking session not found.");

        var now = timeProvider.GetUtcNow().UtcDateTime;
        // Conditional SQL update preserves the first timestamp even for concurrent acknowledgements.
        // Not-required sessions and repeated acknowledgements are successful no-ops.
        await ownedSession
            .Where(session => session.ReceptionCoordinationRequired &&
                session.ReceptionCoordinationAcknowledgedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(session => session.ReceptionCoordinationAcknowledgedAtUtc, now),
                cancellationToken);
    }
}
