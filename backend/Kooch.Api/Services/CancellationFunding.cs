using System.Security.Cryptography;
using System.Text;
using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

// Opaque handles are matched only against this reservation's immutable funding facts.
// They are not credentials; the existing Admin financial authorization remains mandatory.
internal static class CancellationFunding
{
    internal sealed record Source(string Token, decimal Amount, Payment? Payment,
        PaymentItem? Item, ReservationWalletFundingAllocation? Allocation, WalletLot? Lot, WalletAccount? Account);
    internal sealed record Facts(ReservationFinancialSnapshot Snapshot, FinancialEntry Payable, IReadOnlyList<Source> Sources);

    internal static async Task<Facts> LoadAsync(KoochDbContext db, int reservationId, CancellationToken ct)
    {
        var reservation = await db.Reservations.IgnoreQueryFilters().AsNoTracking().SingleAsync(r => r.Id == reservationId, ct);
        var snapshot = await db.ReservationFinancialSnapshots.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(s => s.ReservationId == reservationId, ct)
            ?? throw new InvalidOperationException("Original reservation financial snapshot is required.");
        var correlation = snapshot.PaymentId.HasValue ? $"payment:{snapshot.PaymentId}:reservation:{reservationId}"
            : $"wallet-funding:{snapshot.BookingFundingAttemptId}:reservation:{reservationId}";
        var payable = await db.FinancialEntries.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(e =>
            e.EntryType == FinancialEntryType.PropertyPayable && e.CorrelationKey == correlation, ct);
        if (payable is null || snapshot.PropertyId != reservation.PropertyId || snapshot.GrossAmount <= 0 ||
            snapshot.GrossAmount != snapshot.CommissionAmount + snapshot.PropertyPayableAmount ||
            snapshot.CommissionBase != snapshot.GrossAmount || payable.Amount != snapshot.PropertyPayableAmount ||
            payable.PropertyId != reservation.PropertyId || payable.ReservationId != reservationId ||
            payable.PaymentId != snapshot.PaymentId || payable.PaymentItemId != snapshot.PaymentItemId ||
            payable.Currency != snapshot.Currency || !payable.PayableDueDate.HasValue || payable.ReversesEntryId.HasValue)
            throw new InvalidOperationException("Original reservation funding and payable facts are inconsistent.");
        var sources = new List<Source>();
        var external = snapshot.GrossAmount - snapshot.WalletFundingAmount;
        if (external > 0)
        {
            var payment = await db.Payments.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(p => p.Id == snapshot.PaymentId, ct);
            var item = await db.PaymentItems.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(p => p.Id == snapshot.PaymentItemId, ct);
            if (payment is null || payment.Status != PaymentStatus.Successful || payment.Currency != snapshot.Currency ||
                external != (item?.AllocatedAmount ?? payment.Amount) || external > payment.Amount ||
                (item is null ? payment.ReservationId != reservationId || payment.BookingSessionId.HasValue :
                    item.ReservationId != reservationId || item.PaymentId != payment.Id || item.Currency != snapshot.Currency ||
                    payment.BookingSessionId != reservation.BookingSessionId || payment.ReservationId.HasValue))
                throw new InvalidOperationException("External funding provenance is inconsistent.");
            sources.Add(new(Token(snapshot, $"payment:{payment.Id}:{item?.Id}"), external, payment, item, null, null, null));
        }
        var allocations = await db.ReservationWalletFundingAllocations.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.ReservationFinancialSnapshotId == snapshot.Id).OrderBy(a => a.Id).ToListAsync(ct);
        if (allocations.Sum(a => a.Amount) != snapshot.WalletFundingAmount || external < 0)
            throw new InvalidOperationException("Wallet funding provenance does not reconcile.");
        if (snapshot.BookingFundingAttemptId.HasValue)
        {
            var plan = await db.BookingFundingItems.IgnoreQueryFilters().AsNoTracking()
                .Include(i => i.BookingFundingAttempt).ThenInclude(a => a.WalletHold)
                .SingleAsync(i => i.BookingFundingAttemptId == snapshot.BookingFundingAttemptId && i.ReservationId == reservationId, ct);
            if (plan.GuestPayable != snapshot.GrossAmount || plan.WalletAmount != snapshot.WalletFundingAmount ||
                plan.BookingFundingAttempt.PaymentId != snapshot.PaymentId ||
                plan.BookingFundingAttempt.BookingSessionId != reservation.BookingSessionId ||
                plan.BookingFundingAttempt.Currency != snapshot.Currency || !plan.BookingFundingAttempt.AppliedAtUtc.HasValue ||
                plan.BookingFundingAttempt.WalletHold.Status != WalletHoldStatus.Consumed)
                throw new InvalidOperationException("Consumed booking funding plan is inconsistent.");
            var lots = await db.WalletLots.IgnoreQueryFilters().AsNoTracking().Include(l => l.WalletAccount)
                .Where(l => allocations.Select(a => a.WalletLotId).Contains(l.Id)).ToDictionaryAsync(l => l.Id, ct);
            var holdAllocations = await db.WalletHoldAllocations.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.WalletHoldId == plan.BookingFundingAttempt.WalletHoldId).ToDictionaryAsync(a => a.Id, ct);
            var userId = await db.BookingSessions.IgnoreQueryFilters().Where(s => s.Id == reservation.BookingSessionId)
                .Select(s => s.ClientId).SingleAsync(ct);
            foreach (var allocation in allocations)
            {
                if (!lots.TryGetValue(allocation.WalletLotId, out var lot) ||
                    !holdAllocations.TryGetValue(allocation.WalletHoldAllocationId, out var held) ||
                    held.WalletLotId != lot.Id || held.WalletAccountId != allocation.WalletAccountId ||
                    held.Amount < allocation.Amount || allocation.Amount <= 0 ||
                    lot.WalletAccountId != allocation.WalletAccountId || lot.WalletAccount.UserId != userId ||
                    lot.WalletAccount.Currency != snapshot.Currency ||
                    lot.IsWithdrawable != (lot.SourceType == WalletSourceType.CashReceived))
                    throw new InvalidOperationException("Original wallet lot ownership/provenance is inconsistent.");
                sources.Add(new(Token(snapshot, $"wallet:{allocation.Id}"), allocation.Amount, null, null, allocation, lot, lot.WalletAccount));
            }
        }
        else if (allocations.Count != 0) throw new InvalidOperationException("Wallet funding requires its original booking plan.");
        if (sources.Sum(s => s.Amount) != snapshot.GrossAmount)
            throw new InvalidOperationException("Funding sources do not equal the authoritative gross amount.");
        return new(snapshot, payable, sources);
    }

    internal static void Validate(Facts facts, CancellationFinancialResolutionRequest request)
    {
        var rows = request.SourceDispositions;
        if (rows is null || rows.Count != facts.Sources.Count || rows.Select(r => r.SourceToken).Distinct().Count() != rows.Count)
            throw new ArgumentException("Every original source requires exactly one explicit disposition.");
        foreach (var row in rows)
        {
            var source = facts.Sources.SingleOrDefault(s => s.Token == row.SourceToken)
                ?? throw new ArgumentException("Unknown funding source for this reservation.");
            if (!IsMoney(row.CashRefundAmount) || !IsMoney(row.WalletRestoreAmount) || !IsMoney(row.NotReturnedAmount) ||
                row.CashRefundAmount + row.WalletRestoreAmount + row.NotReturnedAmount != source.Amount ||
                (source.Lot is null && row.WalletRestoreAmount != 0) ||
                (source.Lot is { IsWithdrawable: false } && row.CashRefundAmount != 0))
                throw new ArgumentException("Source amounts or permitted return actions are invalid.");
        }
        if (rows.Sum(r => r.CashRefundAmount + r.WalletRestoreAmount) + request.ForfeitedAmount +
            request.FinalPropertyShare + request.FinalKoochShare != facts.Snapshot.GrossAmount)
            throw new ArgumentException("Cash + wallet restore + forfeiture + final shares must equal gross paid.");
    }

    internal static async Task LockWalletsAsync(KoochDbContext db, Facts facts, CancellationToken ct)
    {
        foreach (var account in facts.Sources.Where(s => s.Account is not null).Select(s => s.Account!).DistinctBy(a => a.Id).OrderBy(a => a.Id))
            await WalletAccountLock.Query(db, account.UserId, account.Currency).AsNoTracking().SingleAsync(ct);
    }

    internal static void AddDispositions(KoochDbContext db, Facts facts, CancellationFinancialResolution resolution,
        IReadOnlyList<CancellationSourceDecision> decisions, int actor)
    {
        foreach (var source in facts.Sources)
        {
            var decision = decisions.Single(d => d.SourceToken == source.Token);
            WalletEntry? restore = decision.WalletRestoreAmount > 0 ? new WalletEntry
            {
                WalletAccountId = source.Account!.Id, WalletLotId = source.Lot!.Id,
                Direction = WalletEntryDirection.Credit, Amount = decision.WalletRestoreAmount, CreatedByUserId = actor
            } : null;
            db.CancellationSourceDispositions.Add(new CancellationSourceDisposition
            {
                Resolution = resolution, PaymentId = source.Payment?.Id, PaymentItemId = source.Item?.Id,
                ReservationWalletFundingAllocationId = source.Allocation?.Id, RestoreWalletEntry = restore,
                FundedAmount = source.Amount, CashRefundAmount = decision.CashRefundAmount,
                WalletRestoreAmount = decision.WalletRestoreAmount, NotReturnedAmount = decision.NotReturnedAmount,
                CreatedByUserId = actor
            });
        }
    }

    internal static async Task<ReservationCancellationFinancialStateResponse> ReadAsync(KoochDbContext db, int reservationId, DateTime now, CancellationToken ct)
    {
        var facts = await LoadAsync(db, reservationId, ct);
        var resolution = await db.CancellationFinancialResolutions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(r => r.ReservationId == reservationId, ct);
        var dispositions = await db.CancellationSourceDispositions.IgnoreQueryFilters().AsNoTracking()
            .Where(d => d.CancellationFinancialResolutionId == (resolution == null ? 0 : resolution.Id)).ToListAsync(ct);
        var execution = await db.CancellationCashRefundExecutions.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(e => e.CancellationFinancialResolutionId == (resolution == null ? 0 : resolution.Id), ct);
        var legacyRefund = await db.RefundRecords.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(r => r.ReservationId == reservationId, ct);
        var status = await db.Reservations.IgnoreQueryFilters().Where(r => r.Id == reservationId).Select(r => r.Status).SingleAsync(ct);
        if (resolution is not null && (status != ReservationStatus.Cancelled || resolution.ReservationFinancialSnapshotId != facts.Snapshot.Id ||
            resolution.GrossPaidAmount != facts.Snapshot.GrossAmount || resolution.Currency != facts.Snapshot.Currency ||
            resolution.PaymentId != facts.Snapshot.PaymentId || resolution.PaymentItemId != facts.Snapshot.PaymentItemId ||
            resolution.PropertyId != facts.Snapshot.PropertyId || resolution.GuestRefundAmount + resolution.GuestWalletRestoreAmount +
            resolution.ForfeitedAmount + resolution.FinalPropertyShare + resolution.FinalKoochShare != resolution.GrossPaidAmount))
            throw new InvalidOperationException("Finalized cancellation facts are inconsistent.");
        if (legacyRefund is not null && (legacyRefund.CancellationFinancialResolutionId != resolution?.Id ||
            legacyRefund.PaymentId != facts.Snapshot.PaymentId || legacyRefund.PaymentItemId != facts.Snapshot.PaymentItemId ||
            legacyRefund.PropertyId != facts.Snapshot.PropertyId || legacyRefund.Currency != facts.Snapshot.Currency ||
            legacyRefund.Amount != (resolution?.GuestRefundAmount ?? facts.Snapshot.GrossAmount)))
            throw new InvalidOperationException("Legacy refund and resolution history are inconsistent.");
        if (resolution?.Mode == CancellationFinancialResolutionMode.ManualFundingV2 &&
            (dispositions.Count != facts.Sources.Count || dispositions.Sum(d => d.CashRefundAmount) != resolution.GuestRefundAmount ||
             dispositions.Sum(d => d.WalletRestoreAmount) != resolution.GuestWalletRestoreAmount || legacyRefund is not null ||
             execution is not null && (execution.Amount != resolution.GuestRefundAmount || execution.Currency != resolution.Currency)))
            throw new InvalidOperationException("V2 disposition/execution history is inconsistent.");
        var finalized = resolution is not null || legacyRefund is not null;
        if (status == ReservationStatus.Cancelled && !finalized)
            throw new InvalidOperationException("Paid cancelled reservation has no financial resolution.");
        var sources = facts.Sources.Select(s =>
        {
            var d = dispositions.SingleOrDefault(d => s.Allocation is not null ? d.ReservationWalletFundingAllocationId == s.Allocation.Id :
                d.PaymentId == s.Payment!.Id && d.PaymentItemId == s.Item?.Id);
            return new CancellationFundingSourceResponse(s.Token, s.Lot?.SourceType.ToString() ?? "ExternalPayment", s.Amount,
                s.Lot?.IsWithdrawable ?? true, s.Lot?.ExpiresAtUtc, s.Lot?.ExpiresAtUtc <= now,
                !finalized && (s.Lot is null || s.Lot.IsWithdrawable) ? s.Amount : 0,
                !finalized && s.Lot is not null ? s.Amount : 0, finalized ? 0 : s.Amount,
                s.Lot?.SourceReference, s.Lot?.Reason, s.Payment?.Status.ToString(), s.Payment?.Channel.ToString(),
                d?.CashRefundAmount ?? 0, d?.WalletRestoreAmount ?? 0, d?.NotReturnedAmount ?? 0,
                execution is not null ? d?.CashRefundAmount ?? 0 : legacyRefund?.Amount ?? 0);
        }).ToList();
        var executed = execution?.Amount ?? legacyRefund?.Amount ?? 0;
        var entitled = resolution?.GuestRefundAmount ?? legacyRefund?.Amount ?? 0;
        return new ReservationCancellationFinancialStateResponse
        {
            PaidCancellation = true, GrossPaidAmount = facts.Snapshot.GrossAmount, Currency = facts.Snapshot.Currency,
            Funding = new(facts.Snapshot.GrossAmount - facts.Snapshot.WalletFundingAmount, facts.Snapshot.WalletFundingAmount,
                facts.Sources.Where(s => s.Lot?.IsWithdrawable == true).Sum(s => s.Amount),
                facts.Sources.Where(s => s.Lot?.IsWithdrawable == false).Sum(s => s.Amount), sources),
            Mode = resolution?.Mode, GuestRefundAmount = resolution?.GuestRefundAmount,
            GuestWalletRestoreAmount = resolution?.GuestWalletRestoreAmount ?? 0, ForfeitedAmount = resolution?.ForfeitedAmount ?? 0,
            FinalPropertyShare = resolution?.FinalPropertyShare, FinalKoochShare = resolution?.FinalKoochShare,
            CashRefundExecutedAmount = executed, CashRefundPendingAmount = entitled - executed,
            RefundPending = entitled > executed, AlreadyHandledByLegacyRefundV1 = legacyRefund is not null && resolution is null
        };
    }

    internal static bool IsMoney(decimal value) => value >= 0 && value <= 9999999999999999.99m && decimal.Round(value, 2) == value;
    internal static object? FingerprintSources(IReadOnlyList<CancellationSourceDecision>? sources) => sources?.OrderBy(s => s.SourceToken)
        .Select(s => new { s.SourceToken, Cash = s.CashRefundAmount.ToString("G29", CultureInfo.InvariantCulture),
            Wallet = s.WalletRestoreAmount.ToString("G29", CultureInfo.InvariantCulture), Retained = s.NotReturnedAmount.ToString("G29", CultureInfo.InvariantCulture) }).ToArray();
    private static string Token(ReservationFinancialSnapshot snapshot, string source) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"cancellation-v2:{snapshot.ReservationId}:{snapshot.Id}:{snapshot.CreatedAtUtc.Ticks}:{source}")));
}
