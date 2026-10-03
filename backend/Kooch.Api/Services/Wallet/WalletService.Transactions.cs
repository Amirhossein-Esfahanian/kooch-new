using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Wallet;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Wallet;

public sealed partial class WalletService
{
    public async Task<PagedResult<WalletTransactionResponse>> ListTransactionsAsync(
        int userId, string currency = "IRR", int page = 1, int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        currency = NormalizeCurrency(currency);
        if (userId <= 0 || page < 1 || pageSize is < 1 or > 100)
            throw new ArgumentException("Wallet transaction query is out of range.");

        var query = context.WalletEntries.AsNoTracking()
            .Where(entry => entry.WalletAccount.UserId == userId &&
                entry.WalletAccount.Currency == currency);
        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query.OrderByDescending(entry => entry.CreatedAtUtc)
            .ThenByDescending(entry => entry.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(entry => new WalletTransactionResponse(
                entry.Id, entry.Amount, entry.Direction,
                entry.WalletAccount.Currency, entry.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResult<WalletTransactionResponse>
        {
            Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }
}
