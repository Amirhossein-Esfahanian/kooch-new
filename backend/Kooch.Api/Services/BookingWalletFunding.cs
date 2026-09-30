using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class BookingWalletFunding
{
    public static async Task EnsureCashCancellationSupportedAsync(KoochDbContext context, int reservationId, CancellationToken ct)
    {
        if (await context.ReservationFinancialSnapshots.IgnoreQueryFilters().AnyAsync(s =>
                s.ReservationId == reservationId && s.WalletFundingAmount > 0, ct))
            throw new InvalidOperationException("WalletFundingCancellationUnsupported: cancellation/refund of wallet-funded reservations is unavailable until wallet restoration is supported.");
    }

    public static IReadOnlyList<BookingFundingItem> Allocate(IReadOnlyList<Reservation> reservations, decimal walletAmount)
    {
        var total = reservations.Sum(r => r.FinalAmount);
        if (walletAmount <= 0 || walletAmount > total || walletAmount != decimal.Round(walletAmount, 2) ||
            reservations.Any(r => r.FinalAmount <= 0 || r.FinalAmount != decimal.Round(r.FinalAmount, 2)))
            throw new ArgumentException("Wallet funding must be a positive monetary amount within the authoritative payable.");
        // Floor each proportional share at the persisted 2-decimal scale, then assign the
        // residual in Reservation.Id order, bounded by each reservation's remaining payable.
        var items = reservations.OrderBy(r => r.Id).Select(r => new BookingFundingItem
        {
            ReservationId = r.Id, GuestPayable = r.FinalAmount,
            WalletAmount = decimal.Floor((walletAmount / total) * r.FinalAmount * 100m) / 100m
        }).ToArray();
        var remaining = walletAmount - items.Sum(i => i.WalletAmount);
        foreach (var item in items)
        {
            var residual = Math.Min(remaining, item.GuestPayable - item.WalletAmount);
            item.WalletAmount += residual;
            remaining -= residual;
        }
        if (remaining != 0) throw new InvalidOperationException("Wallet funding allocation is incomplete.");
        return items;
    }

    public static async Task ConsumeAsync(KoochDbContext context, BookingFundingAttempt attempt,
        BookingSession session, Payment? payment, IReadOnlyList<PaymentItem> paymentItems, CancellationToken ct)
    {
        if (context.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Checkout wallet consumption requires the caller's financialization transaction.");
        var hold = await context.WalletHolds.AsNoTracking().Include(h => h.WalletAccount)
            .SingleAsync(h => h.Id == attempt.WalletHoldId, ct);
        if (attempt.AppliedAtUtc.HasValue || hold.WalletAccount.UserId != session.ClientId ||
            hold.WalletAccount.Currency != attempt.Currency || session.Currency != attempt.Currency ||
            attempt.PaymentId != payment?.Id || attempt.Items.Sum(i => i.WalletAmount) != hold.Amount ||
            attempt.Items.Sum(i => i.GuestPayable - i.WalletAmount) != (payment?.Amount ?? 0))
            throw new InvalidOperationException("Checkout funding plan does not match its owner, hold or external payment.");
        var external = attempt.Items.Where(i => i.GuestPayable > i.WalletAmount).ToArray();
        if (external.Length != paymentItems.Count || external.Any(i => !paymentItems.Any(p =>
                p.ReservationId == i.ReservationId && p.AllocatedAmount == i.GuestPayable - i.WalletAmount && p.Currency == attempt.Currency)))
            throw new InvalidOperationException("External payment allocations do not match the funding plan.");
        await new WalletService(context, TimeProvider.System).ConsumeHoldAsync(session.ClientId, attempt.Currency, hold.Id, ct);
    }

    public static async Task AddProvenanceAsync(KoochDbContext context, BookingFundingAttempt attempt, CancellationToken ct)
    {
        var sources = await context.WalletHoldAllocations.AsNoTracking().Where(a => a.WalletHoldId == attempt.WalletHoldId)
            .OrderBy(a => a.Id).ToListAsync(ct);
        var available = sources.ToDictionary(a => a.Id, a => a.Amount);
        foreach (var item in attempt.Items.OrderBy(i => i.ReservationId))
        {
            var snapshot = context.ReservationFinancialSnapshots.Local.Single(s =>
                s.ReservationId == item.ReservationId && s.BookingFundingAttemptId == attempt.Id);
            var remaining = item.WalletAmount;
            foreach (var source in sources)
            {
                var amount = Math.Min(remaining, available[source.Id]);
                if (amount == 0) continue;
                context.ReservationWalletFundingAllocations.Add(new ReservationWalletFundingAllocation
                {
                    ReservationFinancialSnapshot = snapshot, WalletHoldAllocationId = source.Id,
                    WalletLotId = source.WalletLotId, WalletAccountId = source.WalletAccountId, Amount = amount
                });
                available[source.Id] -= amount;
                remaining -= amount;
            }
            if (remaining != 0) throw new InvalidOperationException("Reservation wallet provenance is incomplete.");
        }
        if (available.Values.Any(a => a != 0)) throw new InvalidOperationException("Consumed wallet funds were not fully attributed.");
        attempt.AppliedAtUtc = DateTime.UtcNow;
    }

    public static async Task ReleaseFailedPaymentAsync(KoochDbContext context, Payment payment, CancellationToken ct)
    {
        var attempt = await context.BookingFundingAttempts.AsNoTracking().SingleOrDefaultAsync(a => a.PaymentId == payment.Id, ct);
        if (attempt is null || attempt.AppliedAtUtc.HasValue) return;
        var hold = await context.WalletHolds.AsNoTracking().Include(h => h.WalletAccount).SingleAsync(h => h.Id == attempt.WalletHoldId, ct);
        if (hold.Status == WalletHoldStatus.Active)
            await new WalletService(context, TimeProvider.System).ReleaseHoldAsync(hold.WalletAccount.UserId, attempt.Currency, hold.Id, ct);
    }
}
