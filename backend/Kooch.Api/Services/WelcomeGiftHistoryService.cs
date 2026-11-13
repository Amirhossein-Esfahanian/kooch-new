using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.WelcomeGifts;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class WelcomeGiftHistoryService(KoochDbContext dbContext)
{
    public async Task<PagedResult<GuestWelcomeGiftResponse>> ListAsync(
        int userId, int page = 1, int pageSize = 20, CancellationToken cancellationToken = default)
    {
        if (userId <= 0) throw new UnauthorizedAccessException("Invalid authenticated user.");
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100)
            throw new ArgumentException("Welcome gift history query is out of range.");

        var query = dbContext.WelcomeGiftGrants.AsNoTracking()
            .Where(grant => grant.UserId == userId && grant.WalletLot.WalletAccount.UserId == userId);
        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query.OrderByDescending(grant => grant.GrantedAtUtc)
            .ThenByDescending(grant => grant.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(grant => new GuestWelcomeGiftResponse(
                "هدیهٔ خوشامدگویی", grant.AmountSnapshot, grant.WalletLot.WalletAccount.Currency,
                grant.GrantedAtUtc, grant.ExpiresAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResult<GuestWelcomeGiftResponse>
        {
            Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize,
            TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }
}
