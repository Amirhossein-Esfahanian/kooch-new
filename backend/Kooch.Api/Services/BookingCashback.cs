using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class BookingCashback
{
    internal static async Task CreatePendingAsync(KoochDbContext dbContext,
        IReadOnlyList<Reservation> reservations, CancellationToken cancellationToken)
    {
        var settings = new CashbackSettingsService(dbContext);
        var entitlements = new ReservationCashbackEntitlementService(dbContext);
        var reservationIds = reservations.Select(r => r.Id).ToHashSet();
        var propertyIds = reservations.Select(r => r.PropertyId).Distinct().ToArray();
        var checkoutTimes = await dbContext.Properties.AsNoTracking()
            .Where(p => propertyIds.Contains(p.Id))
            .Select(p => new { p.Id, p.CheckOutTime })
            .ToDictionaryAsync(p => p.Id, p => p.CheckOutTime, cancellationToken);

        var allocations = dbContext.ReservationWalletFundingAllocations.Local
            .Where(a => a.ReservationFinancialSnapshot is not null &&
                        reservationIds.Contains(a.ReservationFinancialSnapshot.ReservationId)).ToArray();
        var lotIds = allocations.Select(a => a.WalletLotId).Distinct().ToArray();
        var lots = await dbContext.WalletLots.AsNoTracking()
            .Where(lot => lotIds.Contains(lot.Id))
            .Select(lot => new { lot.Id, lot.IsWithdrawable })
            .ToArrayAsync(cancellationToken);
        if (lots.Length != lotIds.Length)
            throw new InvalidOperationException("Checkout wallet provenance references a missing lot.");
        var nonWithdrawableLots = lots.Where(lot => !lot.IsWithdrawable)
            .Select(lot => lot.Id).ToHashSet();

        foreach (var reservation in reservations)
        {
            var snapshot = dbContext.ReservationFinancialSnapshots.Local
                .Single(s => s.ReservationId == reservation.Id);
            var funding = allocations.Where(a => a.ReservationFinancialSnapshot == snapshot).ToArray();
            if (funding.Sum(a => a.Amount) != snapshot.WalletFundingAmount)
                throw new InvalidOperationException("Checkout wallet provenance does not match the financial snapshot.");
            var nonWithdrawable = funding.Where(a => nonWithdrawableLots.Contains(a.WalletLotId)).Sum(a => a.Amount);
            var policy = await settings.GetEffectiveCashbackPolicyAsync(
                reservation.PropertyId, snapshot.Currency, cancellationToken);
            if (!policy.Enabled) continue;
            if (!checkoutTimes.TryGetValue(reservation.PropertyId, out var checkoutTime))
                throw new InvalidOperationException("Cashback property checkout time is unavailable.");

            var eligibleBase = snapshot.GrossAmount - nonWithdrawable;
            var input = new PendingCashbackEntitlementInput(
                reservation.Id, reservation.ClientId, reservation.PropertyId, snapshot.Currency,
                snapshot.GrossAmount, nonWithdrawable, eligibleBase, 0m,
                policy.Source, policy.CalculationMode!.Value, policy.PercentageRate,
                policy.SpendUnitAmount, policy.RewardAmount,
                policy.MaxCashbackPerReservation!.Value, policy.ExpiryDays!.Value,
                IranSiteTime.ToUtc(reservation.CheckOutDate, checkoutTime ?? new TimeOnly(12, 0)));
            var amount = entitlements.CalculateAmount(input);
            if (amount > 0)
                await entitlements.StagePendingAsync(input with { CashbackAmount = amount }, cancellationToken);
        }
    }
}
