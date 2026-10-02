using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationCancellationRequestService(KoochDbContext context, IPermissionService permissionService)
{
    public async Task<AdminReservationCancellationRequestResponse?> GetLatestForAdminAsync(
        int reservationId, CancellationToken cancellationToken = default)
    {
        var row = await context.ReservationCancellationRequests.AsNoTracking()
            .Where(item => item.ReservationId == reservationId)
            .OrderByDescending(item => item.RequestedAtUtc).ThenByDescending(item => item.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : ToAdminResponse(row);
    }

    public async Task<AdminReservationCancellationRequestResponse> RejectAsync(
        int reservationId, int actorId, UserRole actorRole, string? note,
        CancellationToken cancellationToken = default)
    {
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note?.Length > 2000)
            throw new ArgumentException("Resolution note exceeds 2000 characters.");

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;
        await BookingFundingLock.ForReservationAsync(context, reservationId, cancellationToken);
        var reservations = context.Database.IsSqlServer()
            ? context.Reservations.FromSqlInterpolated(
                $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
            : context.Reservations.AsQueryable();
        var reservation = await reservations.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        await EnsureCanManageAsync(actorId, actorRole, reservation.PropertyId, cancellationToken);
        if (reservation.Status == ReservationStatus.Cancelled)
            throw new InvalidOperationException("A cancelled reservation's request cannot be rejected.");

        var pending = await context.ReservationCancellationRequests
            .SingleOrDefaultAsync(item => item.ReservationId == reservationId &&
                item.Status == ReservationCancellationRequestStatus.Pending, cancellationToken);
        if (pending is null)
        {
            if (await context.ReservationCancellationRequests.AnyAsync(item => item.ReservationId == reservationId, cancellationToken))
                throw new InvalidOperationException("No pending cancellation request remains.");
            throw new KeyNotFoundException("Cancellation request not found.");
        }

        pending.Status = ReservationCancellationRequestStatus.Rejected;
        pending.ResolvedAtUtc = DateTime.UtcNow;
        pending.ResolvedByUserId = actorId;
        pending.ResolutionNote = note;
        await context.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return ToAdminResponse(pending);
    }

    public async Task<ReservationCancellationRequestResponse> CreateAsync(
        int userId, string reservationNumber, CreateReservationCancellationRequest request,
        CancellationToken cancellationToken = default)
    {
        var number = NormalizeNumber(reservationNumber);
        var (reason, message) = ValidateRequest(request);

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
        var entity = await CreatePendingAsync(reservation.Id, userId, userId,
            ReservationCancellationRequestSource.GuestOnline, reason, message, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return ToResponse(entity);
    }

    public async Task<AdminReservationCancellationRequestResponse> CreateForSupportAsync(
        int reservationId, int actorId, UserRole actorRole, CreateReservationCancellationRequest request,
        CancellationToken cancellationToken = default)
    {
        var (reason, message) = ValidateRequest(request);
        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;
        await BookingFundingLock.ForReservationAsync(context, reservationId, cancellationToken);
        var reservations = context.Database.IsSqlServer()
            ? context.Reservations.FromSqlInterpolated(
                $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
            : context.Reservations.AsQueryable();
        var reservation = await reservations.AsNoTracking()
            .Where(item => item.Id == reservationId)
            .Select(item => new
            {
                item.Id,
                item.PropertyId,
                item.Status,
                GuestUserId = item.Guest == null ? null : item.Guest.UserId
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        await EnsureCanManageAsync(actorId, actorRole, reservation.PropertyId, cancellationToken);
        if (reservation.Status == ReservationStatus.Cancelled)
            throw new InvalidOperationException("A cancelled reservation cannot receive a cancellation request.");
        if (!reservation.GuestUserId.HasValue ||
            !await context.Users.AsNoTracking().AnyAsync(user => user.Id == reservation.GuestUserId.Value, cancellationToken))
            throw new InvalidOperationException("Reservation has no canonical guest user.");

        var entity = await CreatePendingAsync(reservation.Id, reservation.GuestUserId.Value, actorId,
            ReservationCancellationRequestSource.Support, reason, message, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return ToAdminResponse(entity);
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

    private static (ReservationCancellationReason Reason, string? Message) ValidateRequest(
        CreateReservationCancellationRequest request)
    {
        if (request.Reason is null || !Enum.IsDefined(request.Reason.Value))
            throw new ArgumentException("A valid cancellation reason is required.");
        var message = request.Message?.Trim();
        if (message?.Length > 2000)
            throw new ArgumentException("Cancellation message exceeds 2000 characters.");
        return (request.Reason.Value, message);
    }

    private async Task EnsureCanManageAsync(int actorId, UserRole actorRole, int propertyId,
        CancellationToken cancellationToken)
    {
        if (actorRole is not (UserRole.SuperAdmin or UserRole.AdminAssistant) ||
            !await permissionService.HasPermissionAsync(actorId, PermissionKey.ManageReservations,
                cancellationToken: cancellationToken) ||
            !await permissionService.CanAsync(actorId, propertyId, "bookings.cancel", cancellationToken))
            throw new UnauthorizedAccessException("You cannot manage this reservation's cancellation request.");
    }

    private async Task<ReservationCancellationRequestRecord> CreatePendingAsync(
        int reservationId, int guestUserId, int creatorUserId, ReservationCancellationRequestSource source,
        ReservationCancellationReason reason, string? message, CancellationToken cancellationToken)
    {
        if (await context.ReservationCancellationRequests.AnyAsync(row =>
                row.ReservationId == reservationId &&
                row.Status == ReservationCancellationRequestStatus.Pending, cancellationToken))
            throw new InvalidOperationException("A cancellation request is already pending.");

        var entity = new ReservationCancellationRequestRecord
        {
            ReservationId = reservationId,
            RequestedByUserId = guestUserId,
            CreatedByUserId = creatorUserId,
            RequestSource = source,
            Status = ReservationCancellationRequestStatus.Pending,
            Reason = reason,
            GuestMessage = message,
            RequestedAtUtc = DateTime.UtcNow
        };
        context.ReservationCancellationRequests.Add(entity);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (IsPendingCollision(error))
        {
            throw new InvalidOperationException("A cancellation request is already pending.", error);
        }
        return entity;
    }

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

    private static AdminReservationCancellationRequestResponse ToAdminResponse(ReservationCancellationRequestRecord row) => new()
    {
        Status = row.Status,
        RequestSource = row.RequestSource,
        Reason = row.Reason,
        GuestMessage = row.GuestMessage,
        RequestedAtUtc = row.RequestedAtUtc,
        ResolvedAtUtc = row.ResolvedAtUtc,
        ResolutionNote = row.ResolutionNote
    };
}
