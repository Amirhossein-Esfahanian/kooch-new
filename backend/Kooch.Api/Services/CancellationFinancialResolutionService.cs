using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class CancellationFinancialResolutionService(
    KoochDbContext context, SettlementService settlements, TimeProvider clock)
{
    // When joining a caller's transaction, the caller owns commit/rollback and must abort on failure.
    // The same scoped DbContext must be used by the future cancellation orchestrator.
    public async Task<CancellationFinancialResolutionResult> ResolveAsync(
        CancellationFinancialResolutionRequest request, int actorId, CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(request, actorId);
        var fingerprintPayload = normalized.Mode != CancellationFinancialResolutionMode.ManualFundingV2
            ? JsonSerializer.Serialize(new
            {
                normalized.ReservationId, normalized.Mode,
                Guest = normalized.GuestRefundAmount?.ToString("F2", CultureInfo.InvariantCulture),
                Property = normalized.FinalPropertyShare?.ToString("F2", CultureInfo.InvariantCulture),
                Kooch = normalized.FinalKoochShare?.ToString("F2", CultureInfo.InvariantCulture),
                normalized.Reason, normalized.Note
            }) : JsonSerializer.Serialize(new
        {
            normalized.ReservationId, normalized.Mode,
            Guest = normalized.GuestRefundAmount?.ToString("F2", CultureInfo.InvariantCulture),
            Property = normalized.FinalPropertyShare?.ToString("F2", CultureInfo.InvariantCulture),
            Kooch = normalized.FinalKoochShare?.ToString("F2", CultureInfo.InvariantCulture),
            normalized.Reason, normalized.Note,
            Forfeit = normalized.ForfeitedAmount?.ToString("G29", CultureInfo.InvariantCulture),
            Sources = CancellationFunding.FingerprintSources(normalized.SourceDispositions)
        });
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprintPayload)));
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            var result = await ResolveCoreAsync(normalized, actorId, fingerprint, cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch (DbUpdateException error) when (IsResolutionCollision(error))
        {
            throw new InvalidOperationException("Cancellation resolution, idempotency key or correction already exists.", error);
        }
    }

    private async Task<CancellationFinancialResolutionResult> ResolveCoreAsync(
        CancellationFinancialResolutionRequest request, int actorId, string fingerprint, CancellationToken ct)
    {
        var reservationId = request.ReservationId;
        var v2 = request.Mode == CancellationFinancialResolutionMode.ManualFundingV2;
        CancellationFunding.Facts? funding = null;
        int? paymentId;
        PaymentItem? item;
        decimal gross;
        string currency;
        ReservationFinancialSnapshot snapshot;
        FinancialEntry original;
        if (v2)
        {
            await BookingFundingLock.ForReservationAsync(context, reservationId, ct);
            if (context.Database.IsSqlServer())
                await context.Reservations.FromSqlInterpolated(
                    $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
                    .IgnoreQueryFilters().AsNoTracking().SingleAsync(ct);
            funding = await CancellationFunding.LoadAsync(context, reservationId, ct);
            if (await context.Reservations.AnyAsync(r => r.Id == reservationId && r.Status == ReservationStatus.CapacityLost, ct))
                throw new InvalidOperationException("CapacityLost is outside cancellation financial resolution.");
            CancellationFunding.Validate(funding, request);
            await CancellationFunding.LockWalletsAsync(context, funding, ct);
            snapshot = funding.Snapshot;
            original = funding.Payable;
            paymentId = snapshot.PaymentId;
            item = funding.Sources.FirstOrDefault(s => s.Payment is not null)?.Item;
            gross = snapshot.GrossAmount;
            currency = snapshot.Currency;
        }
        else
        {
        await BookingWalletFunding.EnsureCashCancellationSupportedAsync(context, reservationId, ct);
        var candidates = await context.Payments.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.Status == PaymentStatus.Successful && (p.ReservationId == reservationId ||
                context.PaymentItems.IgnoreQueryFilters().Any(i => i.PaymentId == p.Id && i.ReservationId == reservationId)))
            .Select(p => p.Id).Take(2).ToListAsync(ct);
        if (candidates.Count != 1)
            throw new InvalidOperationException("Exactly one successful payment allocation is required.");
        paymentId = candidates[0];
        var payment = context.Database.IsSqlServer()
            ? await context.Payments.FromSqlInterpolated(
                    $"SELECT * FROM [Payments] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {paymentId}")
                .IgnoreQueryFilters().AsNoTracking().SingleAsync(ct)
            : await context.Payments.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == paymentId, ct);
        if (payment.Status != PaymentStatus.Successful)
            throw new InvalidOperationException("Only successful payment allocations can be resolved.");
        var reservation = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.Id == reservationId).Select(r => new { r.PropertyId, r.BookingSessionId, r.Status }).SingleAsync(ct);
        if (reservation.Status == ReservationStatus.CapacityLost)
            throw new InvalidOperationException("CapacityLost is outside cancellation financial resolution; use standalone Refund V1.");
        item = await context.PaymentItems.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(i => i.PaymentId == paymentId && i.ReservationId == reservationId, ct);
        if (payment.ReservationId.HasValue
            ? payment.ReservationId != reservationId || payment.BookingSessionId.HasValue || item is not null
            : !payment.BookingSessionId.HasValue || item is null || payment.BookingSessionId != reservation.BookingSessionId)
            throw new InvalidOperationException("Payment allocation linkage is inconsistent.");
        gross = item?.AllocatedAmount ?? payment.Amount;
        currency = item?.Currency ?? payment.Currency;
        if (!IsMoney(gross) || !IsMoney(payment.Amount) || gross > payment.Amount ||
            string.IsNullOrWhiteSpace(currency) || currency.Length != 3 || currency != payment.Currency)
            throw new InvalidOperationException("Payment allocation amount or currency is inconsistent.");

        snapshot = (await context.ReservationFinancialSnapshots.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(s => s.PaymentId == paymentId && s.ReservationId == reservationId, ct))!;
        // Matches PaymentFinancializationService.ApplyAsync; never select the only payable of an allocation.
        var originalCorrelation = $"payment:{paymentId}:reservation:{reservationId}";
        original = (await context.FinancialEntries.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(e => e.EntryType == FinancialEntryType.PropertyPayable && e.CorrelationKey == originalCorrelation, ct))!;
        if (snapshot is null || original is null)
            throw new InvalidOperationException("Original snapshot and recognized PropertyPayable are required; standalone no-payable refunds are separate.");
        if (snapshot.PropertyId != reservation.PropertyId || snapshot.PaymentItemId != item?.Id ||
            snapshot.GrossAmount != gross || snapshot.CommissionBase != gross || snapshot.Currency != currency ||
            !IsMoney(snapshot.CommissionAmount) || !IsMoney(snapshot.PropertyPayableAmount) ||
            snapshot.CommissionAmount + snapshot.PropertyPayableAmount != gross ||
            original.PropertyId != snapshot.PropertyId || original.ReservationId != reservationId ||
            original.PaymentId != paymentId || original.PaymentItemId != item?.Id || original.Currency != currency ||
            original.Amount != snapshot.PropertyPayableAmount || original.ReversesEntryId.HasValue || !original.PayableDueDate.HasValue)
            throw new InvalidOperationException("Original payment, snapshot and payable facts are inconsistent.");

        }
        await PropertyFinanceLock.AcquireAsync(context, snapshot.PropertyId, ct);
        var existing = await context.CancellationFinancialResolutions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdempotencyKey == request.IdempotencyKey, ct);
        if (existing is not null)
        {
            if (existing.RequestFingerprint != fingerprint)
                throw new InvalidOperationException("Idempotency key was used for a different cancellation allocation.");
            return new(CancellationFinancialResolutionOutcome.Finalized, existing, null, original.Amount, snapshot.CommissionAmount);
        }
        if (await context.CancellationFinancialResolutions.IgnoreQueryFilters().AnyAsync(
                r => r.ReservationId == reservationId, ct))
            throw new InvalidOperationException("This allocation already has a finalized cancellation resolution.");

        var guest = v2 ? request.SourceDispositions!.Sum(s => s.CashRefundAmount) : request.Mode == CancellationFinancialResolutionMode.AutomaticFullRefundV1 ? gross : request.GuestRefundAmount!.Value;
        var restore = v2 ? request.SourceDispositions!.Sum(s => s.WalletRestoreAmount) : 0m;
        var forfeit = v2 ? request.ForfeitedAmount!.Value : 0m;
        var property = request.Mode == CancellationFinancialResolutionMode.AutomaticFullRefundV1 ? 0m : request.FinalPropertyShare!.Value;
        var kooch = request.Mode == CancellationFinancialResolutionMode.AutomaticFullRefundV1 ? 0m : request.FinalKoochShare!.Value;
        if (guest + restore + forfeit + property + kooch != gross)
            throw new ArgumentException("Guest refund + final Property share + final Kooch share must equal gross paid.");

        var priorRefund = await context.RefundRecords.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.PaymentId == paymentId && r.ReservationId == reservationId, ct);
        var priorCorrections = await context.FinancialEntries.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ReversesEntryId == original.Id).Take(2).ToListAsync(ct);
        var activeBatch = await context.SettlementItems.IgnoreQueryFilters().AsNoTracking()
            .Where(i => i.FinancialEntryId == original.Id && i.ReleasedAtUtc == null)
            .Select(i => new { i.SettlementId, i.Settlement.PropertyId, i.Settlement.PaidAtUtc, i.Settlement.CancelledAtUtc })
            .SingleOrDefaultAsync(ct);
        if (priorRefund is not null || priorCorrections.Count > 0)
        {
            if (v2) throw new InvalidOperationException("Existing refund/correction history cannot be overwritten by V2.");
            var reversal = priorCorrections.Count == 1 ? priorCorrections[0] : null;
            if (priorRefund is null || priorRefund.CancellationFinancialResolutionId.HasValue ||
                priorRefund.Amount != gross || priorRefund.Currency != currency || priorRefund.PropertyId != snapshot.PropertyId ||
                priorRefund.PaymentItemId != item?.Id || priorRefund.ReservationFinancialSnapshotId != snapshot.Id ||
                priorRefund.OriginalPropertyPayableEntryId != original.Id || reversal is null ||
                reversal.EntryType != FinancialEntryType.Reversal || reversal.Amount != -original.Amount ||
                reversal.Currency != currency || reversal.PropertyId != snapshot.PropertyId ||
                reversal.PaymentId != paymentId || reversal.PaymentItemId != item?.Id || reversal.ReservationId != reservationId ||
                activeBatch is not null)
                throw new InvalidOperationException("Legacy refund/reversal history is inconsistent; no resolution was created.");
            return new(CancellationFinancialResolutionOutcome.AlreadyHandledByLegacyRefundV1, null,
                priorRefund.Id, original.Amount, snapshot.CommissionAmount);
        }
        // Preserve the approved conservative boundary, including unchanged-share requests.
        if (await context.SettlementItems.IgnoreQueryFilters().AnyAsync(i =>
                i.FinancialEntryId == original.Id && i.Settlement.PaidAtUtc != null, ct))
            throw new InvalidOperationException("PostSettlementNettingRequired: paid settlement allocations cannot be financially finalized yet.");
        if (activeBatch is not null && (activeBatch.PropertyId != snapshot.PropertyId || activeBatch.CancelledAtUtc.HasValue))
            throw new InvalidOperationException("Active settlement allocation history is inconsistent.");

        var now = clock.GetUtcNow().UtcDateTime;
        int? releasedSettlementId = null;
        FinancialEntry? reversalEntry = null;
        FinancialEntry? replacement = null;
        if (property != original.Amount)
        {
            if (activeBatch is not null)
            {
                await settlements.CancelAsync(activeBatch.SettlementId, $"Cancellation financial resolution: {request.Reason}", actorId, ct);
                releasedSettlementId = activeBatch.SettlementId;
            }
            var correlation = v2 ? $"cancellation:funding:{snapshot.Id}:reservation:{reservationId}" : $"cancellation:payment:{paymentId}:reservation:{reservationId}";
            reversalEntry = new FinancialEntry
            {
                PropertyId = original.PropertyId, ReservationId = reservationId, PaymentId = paymentId,
                PaymentItemId = item?.Id, Currency = currency, EntryType = FinancialEntryType.Reversal,
                ReversesEntryId = original.Id, Amount = -original.Amount, EffectiveAtUtc = now,
                CorrelationKey = $"{correlation}:reversal", Reason = request.Reason, CreatedByUserId = actorId
            };
            context.FinancialEntries.Add(reversalEntry);
            if (property > 0)
            {
                replacement = new FinancialEntry
                {
                    PropertyId = original.PropertyId, ReservationId = reservationId, PaymentId = paymentId,
                    PaymentItemId = item?.Id, Currency = currency, EntryType = FinancialEntryType.PropertyPayable,
                    Amount = property, PayableDueDate = original.PayableDueDate, EffectiveAtUtc = now,
                    CorrelationKey = $"{correlation}:replacement", Reason = "Cancellation financial resolution: replacement Property entitlement.",
                    CreatedByUserId = actorId
                };
                context.FinancialEntries.Add(replacement);
            }
            // Obtain posting IDs before the immutable resolution's sole insert, in the same transaction.
            await context.SaveChangesAsync(ct);
        }
        var resolution = new CancellationFinancialResolution
        {
            ReservationId = reservationId, PaymentId = paymentId, PaymentItemId = item?.Id, PropertyId = snapshot.PropertyId,
            ReservationFinancialSnapshotId = snapshot.Id, OriginalPropertyPayableEntryId = original.Id,
            GrossPaidAmount = gross, Currency = currency, GuestRefundAmount = guest, FinalPropertyShare = property,
            GuestWalletRestoreAmount = restore, ForfeitedAmount = forfeit,
            FinalKoochShare = kooch, Mode = request.Mode, Reason = request.Reason, Note = request.Note,
            ResolvedByUserId = actorId, ResolvedAtUtc = now, IdempotencyKey = request.IdempotencyKey,
            RequestFingerprint = fingerprint, ReversalFinancialEntryId = reversalEntry?.Id,
            ReplacementPropertyPayableEntryId = replacement?.Id, ReleasedSettlementId = releasedSettlementId,
            CreatedByUserId = actorId
        };
        context.CancellationFinancialResolutions.Add(resolution);
        if (v2) CancellationFunding.AddDispositions(context, funding!, resolution, request.SourceDispositions!, actorId);
        await context.SaveChangesAsync(ct);
        return new(CancellationFinancialResolutionOutcome.Finalized, resolution, null, original.Amount, snapshot.CommissionAmount);
    }

    private static CancellationFinancialResolutionRequest Normalize(CancellationFinancialResolutionRequest request, int actorId)
    {
        if (request.ReservationId <= 0 || actorId <= 0 || !Enum.IsDefined(request.Mode))
            throw new ArgumentException("A valid reservation, actor and resolution mode are required.");
        if (request.Mode == CancellationFinancialResolutionMode.ManualFundingV2)
        {
            if (request.GuestRefundAmount.HasValue || request.SourceDispositions is null ||
                !request.FinalPropertyShare.HasValue || !request.FinalKoochShare.HasValue || !request.ForfeitedAmount.HasValue ||
                !IsMoney(request.FinalPropertyShare.Value) || !IsMoney(request.FinalKoochShare.Value) || !IsMoney(request.ForfeitedAmount.Value))
                throw new ArgumentException("Manual funding mode requires explicit sources, final shares and forfeiture; cash is derived from sources.");
        }
        else if (request.SourceDispositions is not null || request.ForfeitedAmount.HasValue)
            throw new ArgumentException("Source dispositions require ManualFundingV2.");
        else if (request.Mode == CancellationFinancialResolutionMode.ManualOverride)
        {
            if (!request.GuestRefundAmount.HasValue || !request.FinalPropertyShare.HasValue || !request.FinalKoochShare.HasValue ||
                !IsMoney(request.GuestRefundAmount.Value) || !IsMoney(request.FinalPropertyShare.Value) || !IsMoney(request.FinalKoochShare.Value))
                throw new ArgumentException("Manual mode requires all three nonnegative decimal(18,2) amounts without rounding.");
        }
        else if (request.GuestRefundAmount.HasValue || request.FinalPropertyShare.HasValue || request.FinalKoochShare.HasValue)
            throw new ArgumentException("Automatic mode does not accept manual allocation values.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 2000) throw new ArgumentException("Note cannot exceed 2000 characters.");
        return request with { Reason = Required(request.Reason, 1000), Note = note, IdempotencyKey = Required(request.IdempotencyKey, 200) };
    }

    private static bool IsMoney(decimal value) => value >= 0 && value <= 9999999999999999.99m && value == decimal.Truncate(value * 100m) / 100m;
    private static string Required(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max
        ? value.Trim() : throw new ArgumentException($"Required decision metadata must not exceed {max} characters.");
    private static bool IsResolutionCollision(DbUpdateException error) => error.InnerException is SqlException sql &&
        sql.Errors.Cast<SqlError>().Any(e => e.Number is 2601 or 2627 &&
            (e.Message.Contains("IX_CancellationFinancialResolutions_", StringComparison.Ordinal) ||
             e.Message.Contains("IX_FinancialEntries_ReversesEntryId", StringComparison.Ordinal) ||
             e.Message.Contains("IX_FinancialEntries_EntryType_CorrelationKey", StringComparison.Ordinal)));
}
