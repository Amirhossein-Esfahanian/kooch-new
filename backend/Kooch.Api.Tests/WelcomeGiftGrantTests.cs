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

    [Fact]
    public async Task LinkedIranianIdentity_GrantsOnceWithWalletHistoryAndImmutableExpiry()
    {
        await using var db = CreateDb();
        var campaign = Campaign();
        db.WelcomeGiftCampaigns.Add(campaign);
        db.Users.Add(User(1, "09120000001"));
        await db.SaveChangesAsync();
        var grantService = new WelcomeGiftGrantService(db, new FixedClock());
        var guestService = new GuestService(db, grantService);

        var guest = await guestService.CreateAsync(Request("09120000001", Code(123456789)));
        var grant = Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        var lot = Assert.Single(await db.WalletLots.ToListAsync());
        var credit = Assert.Single(await db.WalletEntries.ToListAsync());
        Assert.Equal(guest.UserId, grant.UserId);
        Assert.Equal(campaign.Id, grant.CampaignId);
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

        await guestService.UpdateAsync(guest.Id, new GuestUpdateRequest
        {
            FirstName = "Edited", Mobile = "09120000001", Nationality = "ایران",
            NationalCode = Code(123456789)
        });
        await grantService.TryGrantAsync((await db.Guests.SingleAsync()), default);
        Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await db.WalletEntries.ToListAsync());
        Assert.Equal(1, campaign.GrantedCount);

        campaign.Amount = 200m;
        campaign.ValidityDays = 60;
        await db.SaveChangesAsync();
        Assert.Equal(100m, (await db.WelcomeGiftGrants.SingleAsync()).AmountSnapshot);
        Assert.Equal(Now.AddDays(30).UtcDateTime, (await db.WelcomeGiftGrants.SingleAsync()).ExpiresAtUtc);
    }

    [Fact]
    public async Task UnlinkedOrForeignOrInvalidIdentity_DoesNotCreateWalletOrGrant()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        await db.SaveChangesAsync();
        var service = new GuestService(db, new WelcomeGiftGrantService(db, new FixedClock()));
        var unlinked = await service.CreateAsync(Request("09120000001", Code(123456789)));
        Assert.Null(unlinked.UserId);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.WalletAccounts.ToListAsync());

        db.Users.Add(User(2, "09120000002"));
        await db.SaveChangesAsync();
        var foreign = new Guest
        {
            UserId = 2, FirstName = "Foreign", LastName = "Guest",
            Nationality = "France", NationalCode = Code(123456788)
        };
        db.Guests.Add(foreign);
        await db.SaveChangesAsync();
        await new WelcomeGiftGrantService(db, new FixedClock()).TryGrantAsync(foreign);
        Assert.Empty(await db.WelcomeGiftGrants.ToListAsync());
    }

    [Fact]
    public async Task QuotaOne_SecondLinkedIdentityCannotReceiveCredit()
    {
        await using var db = CreateDb();
        var campaign = Campaign();
        campaign.MaxRecipients = 1;
        db.WelcomeGiftCampaigns.Add(campaign);
        db.Users.AddRange(User(1, "09120000001"), User(2, "09120000002"));
        await db.SaveChangesAsync();
        var service = new GuestService(db, new WelcomeGiftGrantService(db, new FixedClock()));
        await service.CreateAsync(Request("09120000001", Code(123456789)));
        await service.CreateAsync(Request("09120000002", Code(123456788)));
        Assert.Equal(1, campaign.GrantedCount);
        Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await db.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task PreviouslyUnlinkedGuest_GrantsOnlyWhenLinkedToExistingUser()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        await db.SaveChangesAsync();
        var service = new GuestService(db, new WelcomeGiftGrantService(db, new FixedClock()));
        var guest = await service.CreateAsync(Request("09120000001", Code(123456789)));
        Assert.Empty(await db.WelcomeGiftGrants.ToListAsync());
        db.Users.Add(User(1, "09120000001"));
        await db.SaveChangesAsync();

        var linked = await service.UpdateAsync(guest.Id, new GuestUpdateRequest
        {
            FirstName = "Test", Mobile = "09120000001", Nationality = "ایران",
            NationalCode = Code(123456789)
        });
        Assert.Equal(1, linked.UserId);
        Assert.Single(await db.WelcomeGiftGrants.ToListAsync());
    }

    [Fact]
    public async Task CampaignWithIssuedGrant_CannotBeHardDeleted()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        db.Users.Add(User(1, "09120000001"));
        await db.SaveChangesAsync();
        await new GuestService(db, new WelcomeGiftGrantService(db, new FixedClock()))
            .CreateAsync(Request("09120000001", Code(123456789)));
        db.ChangeTracker.Clear();
        db.WelcomeGiftCampaigns.Remove(await db.WelcomeGiftCampaigns.SingleAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task PersistedGrantCannotBeEditedOrDeleted()
    {
        await using var db = CreateDb();
        db.WelcomeGiftCampaigns.Add(Campaign());
        db.Users.Add(User(1, "09120000001"));
        await db.SaveChangesAsync();
        await new GuestService(db, new WelcomeGiftGrantService(db, new FixedClock()))
            .CreateAsync(Request("09120000001", Code(123456789)));
        var grant = await db.WelcomeGiftGrants.SingleAsync();
        grant.AmountSnapshot = 300m;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.Entry(grant).State = EntityState.Deleted;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    private static string Code(int firstNine)
    {
        var digits = firstNine.ToString("D9");
        var sum = digits.Select((digit, index) => (digit - '0') * (10 - index)).Sum();
        var remainder = sum % 11;
        return digits + (remainder < 2 ? remainder : 11 - remainder);
    }

    private static GuestCreateRequest Request(string mobile, string nationalCode) => new()
    {
        FirstName = "Test", LastName = "Guest", Mobile = mobile,
        Nationality = "ایران", NationalCode = nationalCode
    };

    private static User User(int id, string mobile) => new()
    {
        Id = id, FirstName = "Test", LastName = "User", PhoneNumber = mobile,
        PasswordHash = "hash", Role = UserRole.Client
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
