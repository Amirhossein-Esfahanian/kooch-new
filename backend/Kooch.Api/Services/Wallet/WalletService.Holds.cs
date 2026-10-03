using System.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Wallet;

public sealed partial class WalletService
{
    private sealed record AvailableLot(int Id, bool IsWithdrawable, DateTime? ExpiresAtUtc,
        DateTime CreatedAtUtc, decimal Available);

    private IQueryable<AvailableLot> AvailableLots(int userId, string currency, DateTime now) =>
        context.WalletLots.AsNoTracking()
            .Where(lot => lot.WalletAccount.UserId == userId && lot.WalletAccount.Currency == currency &&
                (!lot.ExpiresAtUtc.HasValue || lot.ExpiresAtUtc > now))
            .Select(lot => new AvailableLot(lot.Id, lot.IsWithdrawable, lot.ExpiresAtUtc, lot.CreatedAtUtc,
                (context.WalletEntries.Where(entry => entry.WalletLotId == lot.Id)
                    .Sum(entry => (decimal?)(entry.Direction == WalletEntryDirection.Credit ? entry.Amount : -entry.Amount)) ?? 0m)
                - (context.WalletHoldAllocations.Where(allocation => allocation.WalletLotId == lot.Id &&
                        allocation.WalletHold.Status == WalletHoldStatus.Active && allocation.WalletHold.ExpiresAtUtc > now)
                    .Sum(allocation => (decimal?)allocation.Amount) ?? 0m)
                - (context.WalletWithdrawalAllocations.Where(allocation => allocation.WalletLotId == lot.Id &&
                        (allocation.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Pending ||
                         allocation.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Approved))
                    .Sum(allocation => (decimal?)allocation.Amount) ?? 0m)));

    public Task<int> CreateHoldAsync(int userId, string currency, decimal amount, DateTime expiresAtUtc,
        CancellationToken cancellationToken = default)
    {
        if (amount <= 0 || amount > 9999999999999999.99m || amount != decimal.Round(amount, 2))
            throw new ArgumentException("Wallet hold must have a positive decimal(18,2) amount.");
        if (expiresAtUtc.Kind != DateTimeKind.Utc)
            throw new ArgumentException("Wallet hold expiry must be UTC.");
        return WithWalletReservationTransactionAsync(userId, currency, async (account, now) =>
        {
            if (expiresAtUtc <= now) throw new ArgumentException("Wallet hold expiry must be in the future.");
            var lots = await AvailableLots(userId, account.Currency, now).ToListAsync(cancellationToken);
            var ordered = lots.Where(lot => lot.Available > 0)
                .OrderBy(lot => lot.IsWithdrawable)
                .ThenBy(lot => !lot.IsWithdrawable ? lot.ExpiresAtUtc ?? DateTime.MaxValue : DateTime.MaxValue)
                .ThenBy(lot => lot.CreatedAtUtc).ThenBy(lot => lot.Id).ToList();
            if (ordered.Sum(lot => lot.Available) < amount)
                throw new InvalidOperationException("Insufficient available wallet balance.");
            var hold = new WalletHold
            {
                WalletAccountId = account.Id, Amount = amount, ExpiresAtUtc = expiresAtUtc,
                Status = WalletHoldStatus.Active
            };
            var remaining = amount;
            foreach (var lot in ordered)
            {
                if (remaining == 0) break;
                var allocated = Math.Min(remaining, lot.Available);
                hold.Allocations.Add(new WalletHoldAllocation
                {
                    WalletHold = hold, WalletAccountId = account.Id, WalletLotId = lot.Id, Amount = allocated
                });
                remaining -= allocated;
            }
            context.WalletHolds.Add(hold);
            await context.SaveChangesAsync(cancellationToken);
            return hold.Id;
        }, cancellationToken);
    }

    public Task ConsumeHoldAsync(int userId, string currency, int holdId, CancellationToken cancellationToken = default) =>
        WithWalletReservationTransactionAsync(userId, currency, async (account, now) =>
        {
            var hold = await LoadHoldAsync(account.Id, holdId, cancellationToken);
            if (hold.Status != WalletHoldStatus.Active || hold.ExpiresAtUtc <= now)
                throw new InvalidOperationException("Only an active, unexpired wallet hold can be consumed.");
            // Source-lot expiry is deliberately not rechecked: eligibility was fixed at allocation.
            foreach (var allocation in hold.Allocations)
                context.WalletEntries.Add(new WalletEntry
                {
                    WalletAccountId = account.Id, WalletLotId = allocation.WalletLotId,
                    Amount = allocation.Amount, Direction = WalletEntryDirection.Debit
                });
            hold.Status = WalletHoldStatus.Consumed;
            hold.ConsumedAtUtc = now;
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }, cancellationToken);

    public Task ReleaseHoldAsync(int userId, string currency, int holdId, CancellationToken cancellationToken = default) =>
        WithWalletReservationTransactionAsync(userId, currency, async (account, now) =>
        {
            var hold = await LoadHoldAsync(account.Id, holdId, cancellationToken);
            if (hold.Status is WalletHoldStatus.Released or WalletHoldStatus.Expired) return true;
            if (hold.Status != WalletHoldStatus.Active)
                throw new InvalidOperationException("A consumed wallet hold cannot be released.");
            if (hold.ExpiresAtUtc <= now)
            {
                hold.Status = WalletHoldStatus.Expired;
                hold.ExpiredAtUtc = now;
            }
            else
            {
                hold.Status = WalletHoldStatus.Released;
                hold.ReleasedAtUtc = now;
            }
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }, cancellationToken);

    public Task<int> ExpireHoldsAsync(int userId, string currency, CancellationToken cancellationToken = default) =>
        WithWalletReservationTransactionAsync(userId, currency, async (account, now) =>
        {
            var ids = await context.WalletHolds.AsNoTracking().Where(hold => hold.WalletAccountId == account.Id &&
                hold.Status == WalletHoldStatus.Active && hold.ExpiresAtUtc <= now).Select(hold => hold.Id)
                .ToListAsync(cancellationToken);
            foreach (var id in ids)
            {
                var hold = await LoadHoldAsync(account.Id, id, cancellationToken);
                hold.Status = WalletHoldStatus.Expired;
                hold.ExpiredAtUtc = now;
            }
            if (ids.Count != 0) await context.SaveChangesAsync(cancellationToken);
            return ids.Count;
        }, cancellationToken);

    private async Task<WalletHold> LoadHoldAsync(int accountId, int holdId, CancellationToken cancellationToken)
    {
        var hold = await context.WalletHolds.SingleOrDefaultAsync(item => item.Id == holdId &&
            item.WalletAccountId == accountId, cancellationToken)
            ?? throw new KeyNotFoundException("Wallet hold was not found for this account.");
        // A scoped DbContext may already track an older state from before another transaction.
        await context.Entry(hold).ReloadAsync(cancellationToken);
        await context.Entry(hold).Collection(item => item.Allocations).LoadAsync(cancellationToken);
        return hold;
    }

    private async Task<T> WithWalletReservationTransactionAsync<T>(int userId, string currency,
        Func<WalletAccount, DateTime, Task<T>> operation, CancellationToken cancellationToken)
    {
        currency = NormalizeCurrency(currency);
        if (!context.Database.IsRelational())
            throw new InvalidOperationException("Wallet reservations require transactional relational storage.");
        if (context.ChangeTracker.Entries().Any(entry =>
                entry.Entity is WalletAccount or WalletLot or WalletEntry or WalletHold or WalletHoldAllocation or
                    WalletWithdrawalRequest or WalletWithdrawalAllocation &&
                entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Persist pending wallet changes before invoking a reservation operation.");
        var ownsTransaction = context.Database.CurrentTransaction is null;
        if (ownsTransaction && context.ChangeTracker.HasChanges())
            throw new InvalidOperationException("A standalone wallet operation requires no unrelated pending changes.");
        await using var owned = ownsTransaction
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken) : null;
        // Caller-owned transactions are never committed here. The caller owns rollback on failure,
        // as for the existing composed finance services.
        var trackedBefore = context.ChangeTracker.Entries().ToDictionary(entry => entry.Entity, entry => entry.CurrentValues.Clone());
        try
        {
            var account = await WalletAccountLock.Query(context, userId, currency).AsNoTracking()
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw new InvalidOperationException("Wallet account has no available funds.");
            var result = await operation(account, timeProvider.GetUtcNow().UtcDateTime);
            if (owned is not null) await owned.CommitAsync(cancellationToken);
            return result;
        }
        catch
        {
            if (owned is not null)
            {
                await owned.RollbackAsync(CancellationToken.None);
                foreach (var entry in context.ChangeTracker.Entries().Where(entry =>
                             entry.Entity is WalletHold or WalletHoldAllocation or WalletWithdrawalRequest or
                                 WalletWithdrawalAllocation or WalletEntry).ToList())
                {
                    if (!trackedBefore.TryGetValue(entry.Entity, out var before)) entry.State = EntityState.Detached;
                    else
                    {
                        entry.CurrentValues.SetValues(before);
                        entry.OriginalValues.SetValues(before);
                        entry.State = EntityState.Unchanged;
                    }
                }
            }
            throw;
        }
    }
}
