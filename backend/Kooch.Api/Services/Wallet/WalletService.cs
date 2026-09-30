using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Wallet;

public sealed class WalletService(KoochDbContext context, TimeProvider timeProvider)
{
    public async Task<WalletBalanceResponse> GetBalanceAsync(int userId, string currency,
        CancellationToken cancellationToken = default)
    {
        currency = NormalizeCurrency(currency);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var lots = await context.WalletEntries.AsNoTracking()
            .Where(entry => entry.WalletAccount.UserId == userId && entry.WalletAccount.Currency == currency &&
                (!entry.WalletLot.ExpiresAtUtc.HasValue || entry.WalletLot.ExpiresAtUtc > now))
            .GroupBy(entry => new { entry.WalletLotId, entry.WalletLot.IsWithdrawable })
            .Select(group => new
            {
                group.Key.IsWithdrawable,
                Balance = group.Sum(entry => entry.Direction == WalletEntryDirection.Credit ? entry.Amount : -entry.Amount)
            })
            .ToListAsync(cancellationToken);
        decimal withdrawable = 0m, nonWithdrawable = 0m;
        foreach (var lot in lots)
        {
            var available = Math.Max(0m, lot.Balance);
            if (lot.IsWithdrawable) withdrawable += available;
            else nonWithdrawable += available;
        }
        return new(currency, withdrawable + nonWithdrawable, withdrawable, nonWithdrawable);
    }

    public async Task<int> CreateCreditAsync(WalletCreditCommand command,
        CancellationToken cancellationToken = default)
    {
        var currency = NormalizeCurrency(command.Currency);
        if (command.Amount <= 0 || command.Amount > 9999999999999999.99m ||
            command.Amount != decimal.Round(command.Amount, 2))
            throw new ArgumentException("Wallet credit must be a positive decimal(18,2) amount.");
        var withdrawable = command.SourceType switch
        {
            WalletSourceType.CashReceived => true,
            WalletSourceType.PromotionalCredit => false,
            _ => throw new ArgumentException("Unsupported wallet funding source.")
        };
        if (command.ExpiresAtUtc is { } expiry &&
            (expiry.Kind != DateTimeKind.Utc || expiry <= timeProvider.GetUtcNow().UtcDateTime))
            throw new ArgumentException("New wallet funds must have a future UTC expiry or no expiry.");
        var reference = NormalizeMetadata(command.SourceReference, 200);
        var reason = NormalizeMetadata(command.Reason, 1000);
        if (context.Database.CurrentTransaction is not null || context.ChangeTracker.HasChanges())
            throw new InvalidOperationException("Wallet credit owns its transaction and requires no pending changes.");
        if (!context.Database.IsRelational())
            throw new InvalidOperationException("Wallet credit requires transactional relational storage.");

        await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        WalletAccount? createdAccount = null;
        WalletLot? lot = null;
        WalletEntry? credit = null;
        try
        {
            if (!await context.Users.AnyAsync(user => user.Id == command.UserId, cancellationToken))
                throw new KeyNotFoundException("Wallet owner was not found.");

            // The unique index range is locked even before the account exists. Concurrent first
            // funding is serialized by SQL Server; later operations lock this same account boundary.
            var accounts = context.Database.IsSqlServer()
                ? context.WalletAccounts.FromSqlInterpolated(
                    $"SELECT * FROM [WalletAccounts] WITH (UPDLOCK, HOLDLOCK, INDEX(IX_WalletAccounts_UserId_Currency)) WHERE [UserId] = {command.UserId} AND [Currency] = {currency}")
                : context.WalletAccounts;
            var account = await accounts.SingleOrDefaultAsync(
                item => item.UserId == command.UserId && item.Currency == currency, cancellationToken);
            if (account is null)
            {
                account = createdAccount = new WalletAccount { UserId = command.UserId, Currency = currency };
                context.WalletAccounts.Add(account);
            }
            lot = new WalletLot
            {
                WalletAccount = account, SourceType = command.SourceType, IsWithdrawable = withdrawable,
                ExpiresAtUtc = command.ExpiresAtUtc, CreatedByUserId = command.CreatedByUserId,
                SourceReference = reference, Reason = reason
            };
            credit = new WalletEntry
            {
                WalletAccount = account, WalletLot = lot, Direction = WalletEntryDirection.Credit,
                Amount = command.Amount, CreatedByUserId = command.CreatedByUserId
            };
            context.WalletEntries.Add(credit);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return lot.Id;
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            if (credit is not null) context.Entry(credit).State = EntityState.Detached;
            if (lot is not null) context.Entry(lot).State = EntityState.Detached;
            if (createdAccount is not null) context.Entry(createdAccount).State = EntityState.Detached;
            throw;
        }
    }

    private static string NormalizeCurrency(string currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        if (normalized is null || normalized.Length != 3 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("Currency must be a three-letter code.");
        return normalized;
    }

    private static string? NormalizeMetadata(string? value, int maxLength)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (normalized?.Length > maxLength) throw new ArgumentException("Wallet source metadata is too long.");
        return normalized;
    }
}
