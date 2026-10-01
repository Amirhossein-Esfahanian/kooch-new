using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationCancellationRequestService(KoochDbContext context)
{
    public async Task<ReservationCancellationRequestResponse> CreateAsync(
        int userId, string reservationNumber, CreateReservationCancellationRequest request,
        CancellationToken cancellationToken = default)
    {
        var number = NormalizeNumber(reservationNumber);
        if (request.Reason is null || !Enum.IsDefined(request.Reason.Value))
            throw new ArgumentException("A valid cancellation reason is required.");
        var message = request.Message?.Trim();
        if (message?.Length > 2000)
            throw new ArgumentException("Cancellation message exceeds 2000 characters.");

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;
        var reservations = context.Database.IsSqlServer()
            ? context.Reservations.FromSqlInterpolated(
                $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [ReservationNumber] = {number}")
            : context.Reservations.AsQueryable();
        var reservation = await reservations.ForGuestUser(userId)
            .SingleOrDefaultAsync(row => row.ReservationNumber == number, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        if (reservation.Status == ReservationStatus.Cancelled)
            throw new InvalidOperationException("A cancelled reservation cannot receive a cancellation request.");
        if (await context.ReservationCancellationRequests.AnyAsync(row =>
                row.ReservationId == reservation.Id &&
                row.Status == ReservationCancellationRequestStatus.Pending, cancellationToken))
            throw new InvalidOperationException("A cancellation request is already pending.");

        var entity = new ReservationCancellationRequestRecord
        {
            ReservationId = reservation.Id,
            RequestedByUserId = userId,
            CreatedByUserId = userId,
            Status = ReservationCancellationRequestStatus.Pending,
            Reason = request.Reason.Value,
            GuestMessage = message,
            RequestedAtUtc = DateTime.UtcNow
        };
        context.ReservationCancellationRequests.Add(entity);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (IsPendingCollision(error))
        {
            throw new InvalidOperationException("A cancellation request is already pending.", error);
        }
        return ToResponse(entity);
    }

    public async Task<ReservationCancellationRequestResponse> GetLatestAsync(
        int userId, string reservationNumber, CancellationToken cancellationToken = default)
    {
        var number = NormalizeNumber(reservationNumber);
        var reservationId = await context.Reservations.AsNoTracking().ForGuestUser(userId)
            .Where(row => row.ReservationNumber == number)
            .Select(row => (int?)row.Id)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        var request = await context.ReservationCancellationRequests.AsNoTracking()
            .Where(row => row.ReservationId == reservationId)
            .OrderByDescending(row => row.RequestedAtUtc).ThenByDescending(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Cancellation request not found.");
        return ToResponse(request);
    }

    private static string NormalizeNumber(string value) =>
        !string.IsNullOrWhiteSpace(value) ? value.Trim() : throw new KeyNotFoundException("Reservation not found.");

    private static bool IsPendingCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql && sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("IX_ReservationCancellationRequests_ReservationId", StringComparison.Ordinal));

    private static ReservationCancellationRequestResponse ToResponse(ReservationCancellationRequestRecord row) => new()
    {
        Status = row.Status,
        Reason = row.Reason,
        Message = row.GuestMessage,
        RequestedAtUtc = row.RequestedAtUtc,
        ResolvedAtUtc = row.ResolvedAtUtc
    };
}
