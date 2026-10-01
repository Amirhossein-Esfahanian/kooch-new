using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class ReservationRefundService
{
    private async Task<ReservationRefundResponse> RecordFundingRefundAsync(int reservationId, string reference,
        string reason, string key, string? note, DateTime refundedAt, string fingerprint, int actorId, CancellationToken ct)
    {
        await BookingFundingLock.ForReservationAsync(context, reservationId, ct);
        var reservation = context.Database.IsSqlServer()
            ? await context.Reservations.FromSqlInterpolated($"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
                .IgnoreQueryFilters().AsNoTracking().SingleAsync(ct)
            : await context.Reservations.IgnoreQueryFilters().AsNoTracking().SingleAsync(r => r.Id == reservationId, ct);
        if (reservation.Status != ReservationStatus.Cancelled)
            throw new InvalidOperationException("A cash refund requires a finalized cancellation.");
        var state = await CancellationFunding.ReadAsync(context, reservationId, clock.GetUtcNow().UtcDateTime, ct);
        var resolution = await context.CancellationFinancialResolutions.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(r => r.ReservationId == reservationId, ct);
        if (resolution.Mode != CancellationFinancialResolutionMode.ManualFundingV2 || resolution.GuestRefundAmount <= 0)
            throw new InvalidOperationException("NoGuestRefundRequired: no cash entitlement exists.");
        var existing = await context.CancellationCashRefundExecutions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdempotencyKey == key, ct);
        if (existing is not null)
        {
            if (existing.RequestFingerprint != fingerprint || existing.CancellationFinancialResolutionId != resolution.Id)
                throw new InvalidOperationException("RefundIdempotencyConflict: different execution facts.");
            return Response(existing, true);
        }
        if (await context.RefundRecords.IgnoreQueryFilters().AnyAsync(r => r.IdempotencyKey == key, ct))
            throw new InvalidOperationException("RefundIdempotencyConflict: key belongs to a legacy refund.");
        if (state.CashRefundPendingAmount != resolution.GuestRefundAmount)
            throw new InvalidOperationException("RefundAlreadyRecorded: entitlement already executed.");
        var execution = new CancellationCashRefundExecution
        {
            CancellationFinancialResolutionId = resolution.Id, Amount = resolution.GuestRefundAmount, Currency = resolution.Currency,
            ReferenceNumber = reference, Reason = reason, Note = note, RefundedAtUtc = refundedAt,
            RecordedAtUtc = clock.GetUtcNow().UtcDateTime, RecordedByUserId = actorId, CreatedByUserId = actorId,
            IdempotencyKey = key, RequestFingerprint = fingerprint
        };
        context.CancellationCashRefundExecutions.Add(execution);
        await context.SaveChangesAsync(ct);
        return Response(execution, false);

        ReservationRefundResponse Response(CancellationCashRefundExecution e, bool replay) => new(null, reservationId, null, null,
            e.Amount, e.Currency, e.RefundedAtUtc, e.ReferenceNumber, e.Reason, e.Note, e.RecordedAtUtc)
            { ReservationNumber = reservation.ReservationNumber, IdempotentReplay = replay };
    }
}
