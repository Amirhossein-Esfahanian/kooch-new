using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Wallet;

internal static class WalletAccountLock
{
    public static IQueryable<WalletAccount> Query(KoochDbContext context, int userId, string currency)
    {
        if (context.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Wallet account locking requires a transaction.");
        // Keep funding and hold operations on the same unique-index key/range lock,
        // including when a funding operation is about to create the first account.
        return context.Database.IsSqlServer()
            ? context.WalletAccounts.FromSqlInterpolated(
                $"SELECT * FROM [WalletAccounts] WITH (UPDLOCK, HOLDLOCK, INDEX(IX_WalletAccounts_UserId_Currency)) WHERE [UserId] = {userId} AND [Currency] = {currency}")
            : context.WalletAccounts.Where(account => account.UserId == userId && account.Currency == currency);
    }
}
