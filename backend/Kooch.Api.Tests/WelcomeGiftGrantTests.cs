using Kooch.Api.Data;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WelcomeGiftGrantTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 17, 8, 0, 0, TimeSpan.Zero);
    private const string NationalCode = "1234567891";

    [Fact]
    public async Task VerifiedRegistration_GrantsOnceWithWalletHistoryAndImmutableExpiry()
    {
        await using var db = CreateDb();
        var campaign = Campaign();
        var user = User(1, NationalCode);
        db.WelcomeGiftCampaigns.Add(campaign);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var service = new WelcomeGiftGrantService(db, new FixedClock());
        await service.TryGrantForVerifiedRegistrationAsync(user);
        await service.TryGrantForVerifiedRegistrationAsync(user);

        var grant = Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        var lot = Assert.Single(await db.WalletLots.ToListAsync());
        var credit = Assert.Single(await db.WalletEntries.ToListAsync());
        Assert.Equal((campaign.Id, user.Id, NationalCode),
            (grant.CampaignId, grant.UserId, grant.NationalCodeSnapshot));
        Assert.Equal(100m, grant.AmountSnapshot);
        Assert.Equal(30, grant.ValidityDaysSnapshot);
        Assert.Equal(Now.UtcDateTime, grant.GrantedAtUtc);
        Assert.Equal(Now.AddDays(30).UtcDateTime, grant.ExpiresAtUtc);
        Assert.Equal(grant.ExpiresAtUtc, lot.ExpiresAtUtc);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal(WalletSourceType.PromotionalCredit, lot.SourceType);
        Assert.Equal($"welcome-gift:campaign:{campaign.Id}", lot.SourceReference);
        Assert.Equal("Welcome Gift", lot.Reason);
        Assert.Equal("IRR", (await db.WalletAccounts.SingleAsync()).Currency);
        Assert.Equal(WalletEntryDirection.Credit, credit.Direction);
        Assert.Equal(100m, credit.Amount);
        Assert.Equal(lot.Id, grant.WalletLotId);
        Assert.Equal(credit.Id, grant.WalletEntryId);
        Assert.Equal(1, campaign.GrantedCount);

        campaign.Amount = 200m;
        campaign.ValidityDays = 60;
        await db.SaveChangesAsync();
        Assert.Equal(100m, grant.AmountSnapshot);
        Assert.Equal(Now.AddDays(30).UtcDateTime, grant.ExpiresAtUtc);
    }

    [Fact]
    public async Task MissingInvalidOrInactiveRegistrationIntent_DoesNotGrant()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        var noIntent = User(1, null);
        var invalid = User(2, "1234567890");
        var inactive = User(3, "0012345679");
        inactive.IsActive = false;
        db.Users.AddRange(noIntent, invalid, inactive);
        await db.SaveChangesAsync();
        var service = new WelcomeGiftGrantService(db, new FixedClock());

        await service.TryGrantForVerifiedRegistrationAsync(noIntent);
        await service.TryGrantForVerifiedRegistrationAsync(invalid);
        await service.TryGrantForVerifiedRegistrationAsync(inactive);

        Assert.Empty(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Equal(0, (await db.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    [Fact]
    public async Task GuestCreateAndEdit_DoNotLinkUserOrGrant()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        db.Users.Add(User(1, NationalCode));
        await db.SaveChangesAsync();
        var service = new GuestService(db);

        var created = await service.CreateAsync(new GuestCreateRequest
        {
            FirstName = "Guest", Mobile = "09120000001", Nationality = "ایران",
            NationalCode = NationalCode
        });
        var edited = await service.UpdateAsync(created.Id, new GuestUpdateRequest
        {
            FirstName = "Edited", Mobile = "09120000001", Nationality = "ایران",
            NationalCode = NationalCode
        });

        Assert.Null(created.UserId);
        Assert.Null(edited.UserId);
        Assert.Equal("Edited", edited.FirstName);
        Assert.Empty(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task QuotaOne_SecondVerifiedRegistrationCannotReceiveCredit()
    {
        await using var db = CreateDb();
        var campaign = Campaign();
        campaign.MaxRecipients = 1;
        db.WelcomeGiftCampaigns.Add(campaign);
        var first = User(1, NationalCode);
        var second = User(2, "0012345679");
        db.Users.AddRange(first, second);
        await db.SaveChangesAsync();
        var service = new WelcomeGiftGrantService(db, new FixedClock());

        await service.TryGrantForVerifiedRegistrationAsync(first);
        await service.TryGrantForVerifiedRegistrationAsync(second);

        Assert.Equal(1, campaign.GrantedCount);
        Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await db.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task LaterCampaign_CannotGrantSameUserOrNationalCodeAgain()
    {
        await using var db = CreateDb();
        var firstCampaign = Campaign();
        var first = User(1, NationalCode);
        db.WelcomeGiftCampaigns.Add(firstCampaign);
        db.Users.Add(first);
        await db.SaveChangesAsync();
        var service = new WelcomeGiftGrantService(db, new FixedClock());
        await service.TryGrantForVerifiedRegistrationAsync(first);

        firstCampaign.IsActive = false;
        db.WelcomeGiftCampaigns.Add(Campaign());
        var sameCode = User(2, NationalCode);
        db.Users.Add(sameCode);
        first.PendingRegistrationNationalCode = "0012345679";
        await db.SaveChangesAsync();
        await service.TryGrantForVerifiedRegistrationAsync(first);
        await service.TryGrantForVerifiedRegistrationAsync(sameCode);

        Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await db.WalletEntries.ToListAsync());
        Assert.Equal(0, (await db.WelcomeGiftCampaigns.SingleAsync(row => row.IsActive)).GrantedCount);
    }

    [Theory]
    [InlineData(false, 2026, 10, 1, 2026, 10, 31, 0)]
    [InlineData(true, 2026, 10, 18, 2026, 10, 31, 0)]
    [InlineData(true, 2026, 10, 1, 2026, 10, 16, 0)]
    [InlineData(true, 2026, 10, 1, 2026, 10, 31, 10)]
    public async Task IneligibleCampaign_DoesNotGrant(
        bool active, int startYear, int startMonth, int startDay,
        int endYear, int endMonth, int endDay, int grantedCount)
    {
        await using var db = CreateDb();
        var campaign = Campaign();
        campaign.IsActive = active;
        campaign.StartDate = new DateOnly(startYear, startMonth, startDay);
        campaign.EndDate = new DateOnly(endYear, endMonth, endDay);
        campaign.GrantedCount = grantedCount;
        db.WelcomeGiftCampaigns.Add(campaign);
        var user = User(1, NationalCode);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        await new WelcomeGiftGrantService(db, new FixedClock())
            .TryGrantForVerifiedRegistrationAsync(user);

        Assert.Empty(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Equal(grantedCount, campaign.GrantedCount);
    }

    [Fact]
    public async Task IssuedGrantCannotBeHardDeletedOrEdited()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        var user = User(1, NationalCode);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        await new WelcomeGiftGrantService(db, new FixedClock())
            .TryGrantForVerifiedRegistrationAsync(user);

        db.ChangeTracker.Clear();
        db.WelcomeGiftCampaigns.Remove(await db.WelcomeGiftCampaigns.SingleAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var grant = await db.WelcomeGiftGrants.SingleAsync();
        grant.AmountSnapshot = 300m;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.Entry(grant).State = EntityState.Deleted;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    private static User User(int id, string? nationalCode) => new()
    {
        Id = id, FirstName = "Test", LastName = "User", PhoneNumber = $"0912000000{id}",
        PasswordHash = "hash", Role = UserRole.Client, IsActive = true,
        PendingRegistrationNationalCode = nationalCode
    };

    private static WelcomeGiftCampaign Campaign() => new()
    {
        Title = "Welcome", Amount = 100m, StartDate = new DateOnly(2026, 10, 1),
        EndDate = new DateOnly(2026, 10, 31), MaxRecipients = 10,
        ValidityDays = 30, IsActive = true
    };

    private static KoochDbContext CreateDb() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"welcome-grant-{Guid.NewGuid():N}").Options);

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
