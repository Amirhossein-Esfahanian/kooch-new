using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface IWelcomeGiftGrantService
{
    Task TryGrantForVerifiedRegistrationAsync(User user, CancellationToken cancellationToken = default);
}

public sealed class WelcomeGiftGrantService(KoochDbContext dbContext, TimeProvider clock)
    : IWelcomeGiftGrantService
{
    private const string Currency = "IRR";
    // Called only by OTP registration completion inside its transaction.
    public async Task TryGrantForVerifiedRegistrationAsync(User user, CancellationToken cancellationToken = default)
    {
        var nationalCode = user.PendingRegistrationNationalCode;
        if (user.Id <= 0 || !user.IsActive ||
            !GuestNormalization.IsValidIranianNationalCode(nationalCode) ||
            GuestNormalization.NormalizeNationalCode(nationalCode) != nationalCode)
            return;
        if (dbContext.Database.IsRelational() && dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Welcome Gift requires the identity transaction.");
        var now = clock.GetUtcNow().UtcDateTime;
        var localDate = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone).DateTime);
        var campaignQuery = dbContext.Database.IsSqlServer()
            ? dbContext.WelcomeGiftCampaigns.FromSqlInterpolated(
                $"SELECT * FROM [WelcomeGiftCampaigns] WITH (UPDLOCK, HOLDLOCK) WHERE [IsActive] = 1 AND [IsDeleted] = 0 AND [StartDate] <= {localDate} AND [EndDate] >= {localDate}")
            : dbContext.WelcomeGiftCampaigns.Where(row => row.IsActive &&
                row.StartDate <= localDate && row.EndDate >= localDate);
        var campaign = await campaignQuery.SingleOrDefaultAsync(cancellationToken);
        if (campaign is null) return;

        if (await dbContext.WelcomeGiftGrants.AsNoTracking().AnyAsync(row =>
                row.UserId == user.Id || row.NationalCodeSnapshot == nationalCode,
                cancellationToken)) return;
        if (campaign.GrantedCount >= campaign.MaxRecipients) return;
        if (campaign.Amount <= 0 || campaign.ValidityDays < 1)
            throw new InvalidOperationException("Welcome Gift campaign is invalid.");

        var expiry = now.AddDays(campaign.ValidityDays);
        var account = await (dbContext.Database.IsRelational()
                ? WalletAccountLock.Query(dbContext, user.Id, Currency)
                : dbContext.WalletAccounts.Where(row => row.UserId == user.Id && row.Currency == Currency))
            .SingleOrDefaultAsync(cancellationToken);
        if (account is null)
        {
            account = new WalletAccount { UserId = user.Id, Currency = Currency };
            dbContext.WalletAccounts.Add(account);
        }

        var lot = new WalletLot
        {
            WalletAccount = account, SourceType = WalletSourceType.PromotionalCredit,
            IsWithdrawable = false, ExpiresAtUtc = expiry,
            SourceReference = $"welcome-gift:campaign:{campaign.Id}", Reason = "Welcome Gift"
        };
        var entry = new WalletEntry
        {
            WalletAccount = account, WalletLot = lot,
            Direction = WalletEntryDirection.Credit, Amount = campaign.Amount
        };
        dbContext.WalletEntries.Add(entry);
        await dbContext.SaveChangesAsync(cancellationToken);

        dbContext.WelcomeGiftGrants.Add(new WelcomeGiftGrant
        {
            CampaignId = campaign.Id, UserId = user.Id,
            NationalCodeSnapshot = nationalCode!, AmountSnapshot = campaign.Amount,
            ValidityDaysSnapshot = campaign.ValidityDays, GrantedAtUtc = now,
            ExpiresAtUtc = expiry, WalletLotId = lot.Id, WalletEntryId = entry.Id
        });
        campaign.GrantedCount++;
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
