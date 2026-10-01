using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class ReservationRefundService(KoochDbContext context, SettlementService settlements, TimeProvider clock)
{
    public async Task<ReservationRefundResponse> RecordAsync(int reservationId, ReservationRefundRequest request,
        int actorId, CancellationToken cancellationToken = default)
    {
        var reference = Required(request.ReferenceNumber, 200, "Refund reference");
        var reason = Required(request.Reason, 1000, "Refund reason");
        var key = Required(request.IdempotencyKey, 200, "Idempotency key");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 2000) throw new ArgumentException("Refund note cannot exceed 2000 characters.");
        if (actorId <= 0) throw new ArgumentException("A valid Admin actor is required.");
        if (!request.RefundedAt.HasValue || request.RefundedAt == default(DateTimeOffset) ||
            request.RefundedAt > clock.GetUtcNow())
            throw new ArgumentException("A valid, non-future refund timestamp is required.");
        var refundedAt = request.RefundedAt.Value.UtcDateTime;
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { reservationId, reference, refundedAt, reason, note }))));

        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;

        // Share the existing operation-key namespace across legacy and funding-aware executions.
        // Lock both unique-index ranges in the same order before acquiring any funding locks.
        if (context.Database.IsSqlServer())
        {
            await context.RefundRecords.FromSqlInterpolated(
                $"SELECT * FROM [RefundRecords] WITH (UPDLOCK, HOLDLOCK, INDEX(IX_RefundRecords_IdempotencyKey)) WHERE [IdempotencyKey] = {key}")
                .IgnoreQueryFilters().AsNoTracking().ToListAsync(cancellationToken);
            await context.CancellationCashRefundExecutions.FromSqlInterpolated(
                $"SELECT * FROM [CancellationCashRefundExecutions] WITH (UPDLOCK, HOLDLOCK, INDEX(IX_CancellationCashRefundExecutions_IdempotencyKey)) WHERE [IdempotencyKey] = {key}")
                .IgnoreQueryFilters().AsNoTracking().ToListAsync(cancellationToken);
        }

        // Resolve only a successful allocation. Ambiguous legacy data must not pick an arbitrary payment.
        if (await context.CancellationFinancialResolutions.AnyAsync(r => r.ReservationId == reservationId &&
                r.Mode == CancellationFinancialResolutionMode.ManualFundingV2, cancellationToken))
        {
            var result = await RecordFundingRefundAsync(reservationId, reference, reason, key, note, refundedAt,
                fingerprint, actorId, cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return result;
        }
        if (await context.CancellationCashRefundExecutions.IgnoreQueryFilters().AnyAsync(r => r.IdempotencyKey == key, cancellationToken))
            throw new InvalidOperationException("RefundIdempotencyConflict: key belongs to a funding-aware refund.");
        await BookingWalletFunding.EnsureCashCancellationSupportedAsync(context, reservationId, cancellationToken);
        var candidates = await context.Payments.IgnoreQueryFilters().AsNoTracking()
            .Where(payment => payment.Status == PaymentStatus.Successful &&
                (payment.ReservationId == reservationId || context.PaymentItems.IgnoreQueryFilters()
                    .Any(item => item.PaymentId == payment.Id && item.ReservationId == reservationId)))
            .Select(payment => payment.Id).Take(2).ToListAsync(cancellationToken);
        if (candidates.Count != 1)
            throw new InvalidOperationException("Exactly one successful payment allocation is required for a full refund.");
        var paymentId = candidates[0];
        var payment = context.Database.IsSqlServer()
            ? await context.Payments.FromSqlInterpolated(
                    $"SELECT * FROM [Payments] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {paymentId}")
                .IgnoreQueryFilters().AsNoTracking().SingleAsync(cancellationToken)
            : await context.Payments.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == paymentId, cancellationToken);
        if (payment.Status != PaymentStatus.Successful)
            throw new InvalidOperationException("Only successful payments can be refunded.");

        var resolution = await context.CancellationFinancialResolutions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.ReservationId == reservationId, cancellationToken);
        if (resolution is not null)
        {
            var resolvedRefund = await RecordResolvedAsync(reservationId, payment, resolution,
                reference, reason, key, note, refundedAt, fingerprint, actorId, cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return resolvedRefund;
        }

        var existing = await context.RefundRecords.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(record => record.IdempotencyKey == key, cancellationToken);
        if (existing is not null)
        {
            if (existing.RequestFingerprint != fingerprint)
                throw new InvalidOperationException("Idempotency key was already used for a different refund request.");
            return ToResponse(existing);
        }

        var item = await context.PaymentItems.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(i => i.PaymentId == payment.Id && i.ReservationId == reservationId, cancellationToken);
        if (payment.ReservationId.HasValue
            ? payment.ReservationId != reservationId || payment.BookingSessionId.HasValue || item is not null
            : !payment.BookingSessionId.HasValue || item is null)
            throw new InvalidOperationException("Payment allocation linkage is inconsistent.");
        var amount = item?.AllocatedAmount ?? payment.Amount;
        var currency = item?.Currency ?? payment.Currency;
        if (amount <= 0 || decimal.Round(amount, 2) != amount || amount > payment.Amount ||
            string.IsNullOrWhiteSpace(currency) || currency.Length != 3 || currency != payment.Currency)
            throw new InvalidOperationException("Payment allocation amount or currency is inconsistent.");

        var snapshot = await context.ReservationFinancialSnapshots.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(s => s.PaymentId == payment.Id && s.ReservationId == reservationId, cancellationToken);
        // Every current reservation has a real, required PropertyId, including CapacityLost.
        var reservationPropertyId = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.Id == reservationId).Select(r => r.PropertyId).SingleAsync(cancellationToken);
        var propertyId = snapshot?.PropertyId ?? reservationPropertyId;
        await PropertyFinanceLock.AcquireAsync(context, propertyId, cancellationToken);
        if (await context.RefundRecords.IgnoreQueryFilters().AnyAsync(
                record => record.PaymentId == payment.Id && record.ReservationId == reservationId, cancellationToken))
            throw new InvalidOperationException("This payment allocation has already been fully refunded.");
        var payable = await context.FinancialEntries.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(entry => entry.EntryType == FinancialEntryType.PropertyPayable &&
                entry.PaymentId == payment.Id && entry.ReservationId == reservationId, cancellationToken);
        if ((snapshot is null) != (payable is null))
            throw new InvalidOperationException("Financialization history is incomplete; a safe refund cannot be recorded.");
        if (snapshot is not null && payable is not null)
        {
            if (snapshot.GrossAmount != amount || snapshot.Currency != currency || snapshot.PaymentItemId != item?.Id ||
                payable.PropertyId != snapshot.PropertyId || payable.PaymentItemId != item?.Id ||
                payable.Currency != currency || payable.Amount != snapshot.PropertyPayableAmount ||
                payable.Amount < 0 || payable.ReversesEntryId.HasValue)
                throw new InvalidOperationException("Persisted payment, snapshot and payable facts do not match.");
            if (await context.FinancialEntries.IgnoreQueryFilters().AnyAsync(
                    entry => entry.ReversesEntryId == payable.Id, cancellationToken))
                throw new InvalidOperationException("This payable has already been reversed.");
            var allocation = await context.SettlementItems.IgnoreQueryFilters().AsNoTracking()
                .Where(i => i.FinancialEntryId == payable.Id && i.ReleasedAtUtc == null)
                .Select(i => new { i.SettlementId, i.Settlement.PaidAtUtc }).SingleOrDefaultAsync(cancellationToken);
            if (allocation?.PaidAtUtc is not null)
                throw new InvalidOperationException("Post-settlement refund requires future netting support.");
            if (allocation is not null)
                await settlements.CancelAsync(allocation.SettlementId, $"Full refund: {reason}", actorId, cancellationToken);

            context.FinancialEntries.Add(new FinancialEntry
            {
                PropertyId = payable.PropertyId, ReservationId = payable.ReservationId,
                PaymentId = payable.PaymentId, PaymentItemId = payable.PaymentItemId,
                EntryType = FinancialEntryType.Reversal, ReversesEntryId = payable.Id,
                Amount = -payable.Amount, Currency = payable.Currency, Reason = reason,
                CorrelationKey = $"refund:payment:{payment.Id}:reservation:{reservationId}",
                EffectiveAtUtc = refundedAt, CreatedByUserId = actorId
            });
        }
        var refund = new RefundRecord
        {
            PaymentId = payment.Id, PaymentItemId = item?.Id, ReservationId = reservationId,
            PropertyId = propertyId, ReservationFinancialSnapshotId = snapshot?.Id,
            OriginalPropertyPayableEntryId = payable?.Id, Amount = amount, Currency = currency,
            RefundedAtUtc = refundedAt, ReferenceNumber = reference, Reason = reason, Note = note,
            RecordedByUserId = actorId, RecordedAtUtc = clock.GetUtcNow().UtcDateTime,
            IdempotencyKey = key, RequestFingerprint = fingerprint, CreatedByUserId = actorId
        };
        context.RefundRecords.Add(refund);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is SqlException sql &&
            sql.Errors.Cast<SqlError>().Any(e => e.Number is 2601 or 2627 &&
                (e.Message.Contains("IX_RefundRecords_", StringComparison.Ordinal) ||
                 e.Message.Contains("IX_FinancialEntries_ReversesEntryId", StringComparison.Ordinal))))
        {
            throw new InvalidOperationException("Refund key or payment allocation has already been used.", error);
        }
        return ToResponse(refund);
    }

    private async Task<ReservationRefundResponse> RecordResolvedAsync(int reservationId, Payment payment,
        CancellationFinancialResolution resolution, string reference,
        string reason, string key, string? note, DateTime refundedAt, string fingerprint, int actorId,
        CancellationToken cancellationToken)
    {
        await PropertyFinanceLock.AcquireAsync(context, resolution.PropertyId, cancellationToken);
        var persisted = await context.CancellationFinancialResolutions.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(r => r.Id == resolution.Id, cancellationToken);
        var reservation = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.Id == reservationId)
            .Select(r => new { r.Id, r.PropertyId, r.BookingSessionId, r.Status, r.ReservationNumber })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        if (reservation.Status != ReservationStatus.Cancelled)
            throw new InvalidOperationException("A finalized cancellation refund requires a cancelled reservation.");
        var item = await context.PaymentItems.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(i => i.PaymentId == payment.Id && i.ReservationId == reservationId, cancellationToken);
        if (payment.ReservationId.HasValue
            ? payment.ReservationId != reservationId || payment.BookingSessionId.HasValue || item is not null
            : !payment.BookingSessionId.HasValue || item is null || payment.BookingSessionId != reservation.BookingSessionId)
            throw new InvalidOperationException("Payment allocation linkage is inconsistent.");
        var allocatedAmount = item?.AllocatedAmount ?? payment.Amount;
        var allocatedCurrency = item?.Currency ?? payment.Currency;
        var snapshot = await context.ReservationFinancialSnapshots.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(s => s.Id == persisted.ReservationFinancialSnapshotId, cancellationToken);
        var original = await context.FinancialEntries.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(e => e.Id == persisted.OriginalPropertyPayableEntryId, cancellationToken);
        if (persisted.ReservationId != reservationId || persisted.PaymentId != payment.Id ||
            persisted.PaymentItemId != item?.Id || persisted.PropertyId != reservation.PropertyId ||
            persisted.GrossPaidAmount != allocatedAmount || persisted.Currency != allocatedCurrency ||
            allocatedCurrency != payment.Currency || allocatedAmount <= 0 || allocatedAmount > payment.Amount ||
            snapshot is null || snapshot.ReservationId != reservationId || snapshot.PaymentId != payment.Id ||
            snapshot.PaymentItemId != item?.Id || snapshot.PropertyId != persisted.PropertyId ||
            snapshot.GrossAmount != persisted.GrossPaidAmount || snapshot.Currency != persisted.Currency ||
            original is null || original.EntryType != FinancialEntryType.PropertyPayable ||
            original.PaymentId != payment.Id || original.PaymentItemId != item?.Id ||
            original.ReservationId != reservationId || original.PropertyId != persisted.PropertyId ||
            original.Currency != persisted.Currency)
            throw new InvalidOperationException("Finalized cancellation allocation history is inconsistent.");
        if (persisted.GuestRefundAmount == 0)
            throw new InvalidOperationException("NoGuestRefundRequired: cancellation allocation has no guest refund.");
        if (persisted.GuestRefundAmount < 0 || persisted.GuestRefundAmount > persisted.GrossPaidAmount)
            throw new InvalidOperationException("Finalized guest refund amount is inconsistent.");

        var existingForKey = await context.RefundRecords.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdempotencyKey == key, cancellationToken);
        if (existingForKey is not null)
        {
            if (existingForKey.RequestFingerprint != fingerprint ||
                existingForKey.CancellationFinancialResolutionId != persisted.Id ||
                existingForKey.Amount != persisted.GuestRefundAmount || existingForKey.Currency != persisted.Currency)
                throw new InvalidOperationException("RefundIdempotencyConflict: key was used with different execution facts.");
            return ToResolutionResponse(existingForKey, reservation.ReservationNumber, replay: true);
        }
        var prior = await context.RefundRecords.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.PaymentId == payment.Id && r.ReservationId == reservationId, cancellationToken);
        if (prior is not null)
            throw new InvalidOperationException(prior.CancellationFinancialResolutionId == persisted.Id
                ? "RefundAlreadyRecorded: this cancellation allocation was already refunded."
                : "Inconsistent mixed refund history: unrelated legacy refund exists for this allocation.");

        var refund = new RefundRecord
        {
            PaymentId = payment.Id, PaymentItemId = item?.Id, ReservationId = reservationId,
            PropertyId = persisted.PropertyId, ReservationFinancialSnapshotId = snapshot.Id,
            OriginalPropertyPayableEntryId = original.Id, CancellationFinancialResolutionId = persisted.Id,
            Amount = persisted.GuestRefundAmount, Currency = persisted.Currency,
            RefundedAtUtc = refundedAt, ReferenceNumber = reference, Reason = reason, Note = note,
            RecordedByUserId = actorId, RecordedAtUtc = clock.GetUtcNow().UtcDateTime,
            IdempotencyKey = key, RequestFingerprint = fingerprint, CreatedByUserId = actorId
        };
        context.RefundRecords.Add(refund);
        try { await context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException error) when (error.InnerException is SqlException sql &&
            sql.Errors.Cast<SqlError>().Any(e => e.Number is 2601 or 2627 &&
                e.Message.Contains("IX_RefundRecords_", StringComparison.Ordinal)))
        {
            throw new InvalidOperationException("RefundAlreadyRecorded: this cancellation allocation was already refunded.", error);
        }
        return ToResolutionResponse(refund, reservation.ReservationNumber, replay: false);
    }

    private static ReservationRefundResponse ToResolutionResponse(RefundRecord record, string? reservationNumber, bool replay) =>
        ToResponse(record) with
        {
            Id = null, PaymentId = null, PaymentItemId = null,
            ReservationNumber = reservationNumber, IdempotentReplay = replay
        };

    private static string Required(string? value, int length, string field) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= length ? value.Trim()
            : throw new ArgumentException($"{field} is required and cannot exceed {length} characters.");

    private static ReservationRefundResponse ToResponse(RefundRecord r) =>
        new(r.Id, r.ReservationId, r.PaymentId, r.PaymentItemId, r.Amount, r.Currency,
            r.RefundedAtUtc, r.ReferenceNumber, r.Reason, r.Note, r.RecordedAtUtc);
}
