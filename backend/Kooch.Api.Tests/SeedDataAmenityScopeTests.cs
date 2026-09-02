using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SeedDataAmenityScopeTests
{
    [Fact]
    public async Task MissingSeededAmenities_AreCreatedWithInitialScopes()
    {
        await using var dbContext = CreateContext();

        await SeedData.InitializeAsync(dbContext);

        Assert.Equal(
            AmenityScope.Property,
            (await FindBySlugAsync(dbContext, "water")).Scope);
        Assert.Equal(
            AmenityScope.RoomType,
            (await FindBySlugAsync(dbContext, "private-bathroom")).Scope);
        Assert.Equal(
            AmenityScope.Both,
            (await FindBySlugAsync(dbContext, "wifi")).Scope);
    }

    [Theory]
    [InlineData(AmenityScope.Property)]
    [InlineData(AmenityScope.RoomType)]
    [InlineData(AmenityScope.Both)]
    public async Task ExistingSeededAmenityScope_RemainsStableAcrossRepeatedReseeds(
        AmenityScope persistedScope)
    {
        await using var dbContext = CreateContext();
        const int nonstandardId = 713;
        dbContext.AmenityCategories.Add(new AmenityCategory
        {
            Id = 901,
            Name = "Temporary category",
            Slug = "temporary-category",
            IsActive = true
        });
        dbContext.Amenities.Add(new Amenity
        {
            Id = nonstandardId,
            AmenityCategoryId = 901,
            Name = "Outdated WiFi name",
            Slug = "wifi",
            Scope = persistedScope,
            SortOrder = 999
        });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();
        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var reseeded = await FindBySlugAsync(dbContext, "wifi");
        Assert.Equal(nonstandardId, reseeded.Id);
        Assert.Equal(persistedScope, reseeded.Scope);
        Assert.Equal("WiFi", reseeded.Name);
        Assert.Equal(50, reseeded.SortOrder);
        Assert.Equal(
            "base-services",
            (await dbContext.AmenityCategories.FindAsync(reseeded.AmenityCategoryId))!.Slug);
    }

    [Fact]
    public async Task AdminChangedScope_RemainsAfterReseedAndReload()
    {
        await using var dbContext = CreateContext();
        await SeedData.InitializeAsync(dbContext);
        var wifi = await FindBySlugAsync(dbContext, "wifi");
        wifi.Scope = AmenityScope.Property;
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        Assert.Equal(
            AmenityScope.Property,
            (await FindBySlugAsync(dbContext, "wifi")).Scope);
    }

    private static Task<Amenity> FindBySlugAsync(
        KoochDbContext dbContext,
        string slug) =>
        dbContext.Amenities.SingleAsync(amenity => amenity.Slug == slug);

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"seeded-amenity-scopes-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new KoochDbContext(options);
    }
}
