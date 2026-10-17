using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Kooch.Api.Services;

public interface IWelcomeGiftGrantService
{
    bool IsNewIdentity(Guest guest);
    Task TryGrantAsync(Guest guest, CancellationToken cancellationToken = default);
}

public sealed class WelcomeGiftGrantService(KoochDbContext dbContext, TimeProvider clock)
    : IWelcomeGiftGrantService
{
    private const string Currency = "IRR";
    private const string IranianNationality = "ایران";

    public bool IsNewIdentity(Guest guest)
    {
        dbContext.ChangeTracker.DetectChanges();
        EntityEntry<Guest> entry = dbContext.Entry(guest);
        return guest.UserId.HasValue && guest.NationalCode is not null &&
               (entry.State == EntityState.Added ||
                entry.State == EntityState.Modified &&
                (entry.Property(item => item.NationalCode).OriginalValue is null ||
                 entry.Property(item => item.UserId).OriginalValue is null));
    }

    // Called after the identity row is saved, but before its owning transaction commits.
    public async Task TryGrantAsync(Guest guest, CancellationToken cancellationToken = default)
    {
        if (!guest.UserId.HasValue || guest.Id <= 0 ||
            (guest.Nationality is not null && guest.Nationality != IranianNationality &&
             !guest.Nationality.Equals("Iran", StringComparison.OrdinalIgnoreCase) &&
             !guest.Nationality.Equals("IR", StringComparison.OrdinalIgnoreCase)) ||
            !GuestNormalization.IsValidIranianNationalCode(guest.NationalCode) ||
            GuestNormalization.NormalizeNationalCode(guest.NationalCode) != guest.NationalCode)
            return;
        if (dbContext.Database.IsRelational() && dbContext.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Welcome Gift requires the identity transaction.");
        if (!await dbContext.Users.AsNoTracking().AnyAsync(user =>
                user.Id == guest.UserId.Value && user.IsActive, cancellationToken)) return;

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
                row.CampaignId == campaign.Id &&
                (row.UserId == guest.UserId.Value || row.NationalCodeSnapshot == guest.NationalCode),
                cancellationToken)) return;
        if (campaign.GrantedCount >= campaign.MaxRecipients) return;
        if (campaign.Amount <= 0 || campaign.ValidityDays < 1)
            throw new InvalidOperationException("Welcome Gift campaign is invalid.");

        var expiry = now.AddDays(campaign.ValidityDays);
        var account = await (dbContext.Database.IsRelational()
                ? WalletAccountLock.Query(dbContext, guest.UserId.Value, Currency)
                : dbContext.WalletAccounts.Where(row => row.UserId == guest.UserId.Value && row.Currency == Currency))
            .SingleOrDefaultAsync(cancellationToken);
        if (account is null)
        {
            account = new WalletAccount { UserId = guest.UserId.Value, Currency = Currency };
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
            CampaignId = campaign.Id, UserId = guest.UserId.Value,
            NationalCodeSnapshot = guest.NationalCode!, AmountSnapshot = campaign.Amount,
            ValidityDaysSnapshot = campaign.ValidityDays, GrantedAtUtc = now,
            ExpiresAtUtc = expiry, WalletLotId = lot.Id, WalletEntryId = entry.Id
        });
        campaign.GrantedCount++;
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
