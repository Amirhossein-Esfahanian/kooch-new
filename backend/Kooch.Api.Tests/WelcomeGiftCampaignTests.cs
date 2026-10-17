using Kooch.Api.Data;
using Kooch.Api.Dtos.WelcomeGifts;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WelcomeGiftCampaignTests
{
    private static readonly DateOnly Start = new(2026, 10, 1);
    private static readonly DateOnly End = new(2026, 10, 31);

    [Fact]
    public async Task CreateAndRead_PersistsIranOnlyCampaignWithoutCurrencyOrGrants()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        var created = await service.CreateAsync(7, Valid());

        Assert.Equal("Welcome gift", created.Title);
        Assert.Equal(100_000m, created.Amount);
        Assert.Equal(30, created.ValidityDays);
        Assert.Equal(0, created.GrantedCount);
        Assert.Equal(7, (await db.WelcomeGiftCampaigns.SingleAsync()).CreatedByUserId);
        Assert.Null(typeof(WelcomeGiftCampaign).GetProperty("Currency"));
        db.ChangeTracker.Clear();
        Assert.Equal(created, await service.GetAsync(created.Id));
        Assert.Single(await service.ListAsync());
    }

    [Theory]
    [InlineData(0, 10, 30)]
    [InlineData(-1, 10, 30)]
    [InlineData(10, 0, 30)]
    [InlineData(10, -1, 30)]
    [InlineData(10, 10, 0)]
    [InlineData(10, 10, -1)]
    public async Task Create_RejectsInvalidAmountQuotaOrValidity(decimal amount, int maxRecipients, int validityDays)
    {
        await using var db = CreateDb();
        var request = Valid() with { Amount = amount, MaxRecipients = maxRecipients, ValidityDays = validityDays };
        await Assert.ThrowsAsync<ArgumentException>(() => new WelcomeGiftCampaignService(db).CreateAsync(7, request));
        Assert.Empty(db.WelcomeGiftCampaigns);
    }

    [Fact]
    public async Task CreateAndEdit_RejectInvalidTitlePrecisionAndDateRange()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(7, Valid() with { Title = " " }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(7, Valid() with { Amount = 0.001m }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(7, Valid() with { StartDate = End.AddDays(1) }));
        var created = await service.CreateAsync(7, Valid());
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateAsync(8, created.Id, Valid() with { EndDate = Start.AddDays(-1) }));
        Assert.Equal(End, (await service.GetAsync(created.Id)).EndDate);
    }

    [Fact]
    public async Task ActiveCreate_RejectsInclusiveOverlapButAllowsAdjacentOrInactive()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        await service.CreateAsync(7, Valid());

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(7, Valid() with { StartDate = End, EndDate = End.AddDays(5) }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(7, Valid() with { StartDate = Start.AddDays(5), EndDate = End.AddDays(-5) }));
        await service.CreateAsync(7, Valid() with { IsActive = false });
        await service.CreateAsync(7, Valid() with { StartDate = End.AddDays(1), EndDate = End.AddDays(4) });
        Assert.Equal(3, await db.WelcomeGiftCampaigns.CountAsync());
    }

    [Fact]
    public async Task Edit_EnforcesOverlapIncludingReactivationAndExcludesSelf()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        var first = await service.CreateAsync(7, Valid());
        var second = await service.CreateAsync(7, Valid() with
        {
            StartDate = End.AddDays(2), EndDate = End.AddDays(10), IsActive = false
        });

        await service.UpdateAsync(8, first.Id, Valid() with { Title = "Updated" });
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateAsync(8, second.Id, Valid() with
        {
            StartDate = End, EndDate = End.AddDays(10)
        }));
        var unchanged = await service.GetAsync(second.Id);
        Assert.False(unchanged.IsActive);
        Assert.Equal(End.AddDays(2), unchanged.StartDate);
    }

    [Fact]
    public async Task Edit_DoesNotReduceQuotaBelowGrantsOrRewriteGrantCount()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        var created = await service.CreateAsync(7, Valid());
        (await db.WelcomeGiftCampaigns.SingleAsync()).GrantedCount = 3;
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateAsync(8, created.Id, Valid() with { MaxRecipients = 2 }));
        var updated = await service.UpdateAsync(8, created.Id, Valid() with
        {
            Title = "New title", Amount = 150_000m, MaxRecipients = 3, ValidityDays = 90
        });
        Assert.Equal(3, updated.GrantedCount);
        Assert.Equal(3, (await db.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        Assert.Equal(8, (await db.WelcomeGiftCampaigns.SingleAsync()).UpdatedByUserId);
    }

    [Fact]
    public async Task Delete_SoftDeletesCampaignWithoutErasingHistoricalCount()
    {
        await using var db = CreateDb();
        var service = new WelcomeGiftCampaignService(db);
        var created = await service.CreateAsync(7, Valid());
        (await db.WelcomeGiftCampaigns.SingleAsync()).GrantedCount = 2;
        await db.SaveChangesAsync();

        await service.DeleteAsync(8, created.Id);

        Assert.Empty(await service.ListAsync());
        var historical = await db.WelcomeGiftCampaigns.IgnoreQueryFilters().SingleAsync();
        Assert.True(historical.IsDeleted);
        Assert.False(historical.IsActive);
        Assert.Equal(2, historical.GrantedCount);
    }

    private static WelcomeGiftCampaignUpsertRequest Valid() => new(
        " Welcome gift ", 100_000m, Start, End, 10, 30, true);

    private static KoochDbContext CreateDb() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"welcome-gift-{Guid.NewGuid():N}").Options);
}
