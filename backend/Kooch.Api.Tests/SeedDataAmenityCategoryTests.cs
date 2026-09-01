using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SeedDataAmenityCategoryTests
{
    [Fact]
    public async Task MissingSeededCategory_IsCreatedWithInitialIcon()
    {
        await using var dbContext = CreateContext();

        await SeedData.InitializeAsync(dbContext);

        var category = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        Assert.Equal("utilities", category.Icon);
    }

    [Theory]
    [InlineData("/svgs/amenity-categories/base-services.svg")]
    [InlineData(null)]
    [InlineData("garden")]
    public async Task ExistingSeededCategoryIcon_IsPreserved(string? persistedIcon)
    {
        await using var dbContext = CreateContext();
        await SeedData.InitializeAsync(dbContext);
        var category = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        category.Icon = persistedIcon;
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var reseeded = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        Assert.Equal(persistedIcon, reseeded.Icon);
    }

    [Fact]
    public async Task ExistingCanonicalIconWithActualCategoryId_IsPreserved()
    {
        await using var dbContext = CreateContext();
        await SeedData.InitializeAsync(dbContext);
        var category = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        var canonicalIcon = $"/uploads/amenity-categories/{category.Id}/0123456789abcdef0123456789abcdef.svg";
        category.Icon = canonicalIcon;
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var reseeded = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        Assert.Equal(canonicalIcon, reseeded.Icon);
    }

    [Fact]
    public async Task AdminReplacedCanonicalIcon_RemainsAfterReseed()
    {
        await using var dbContext = CreateContext();
        await SeedData.InitializeAsync(dbContext);
        var category = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "health-bathroom");
        var adminIcon = $"/uploads/amenity-categories/{category.Id}/fedcba9876543210fedcba9876543210.svg";
        category.Icon = adminIcon;
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var reseeded = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "health-bathroom");
        Assert.Equal(adminIcon, reseeded.Icon);
    }

    [Fact]
    public async Task SeededCategoryMatching_UsesSlugInsteadOfNumericId()
    {
        await using var dbContext = CreateContext();
        const int nonstandardId = 137;
        const string persistedIcon = "/uploads/amenity-categories/137/abcdef0123456789abcdef0123456789.svg";
        dbContext.AmenityCategories.Add(new AmenityCategory
        {
            Id = nonstandardId,
            Name = "Outdated name",
            Slug = "base-services",
            SortOrder = 999,
            Icon = persistedIcon,
            IsActive = false
        });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var reseeded = await dbContext.AmenityCategories
            .SingleAsync(item => item.Slug == "base-services");
        Assert.Equal(nonstandardId, reseeded.Id);
        Assert.Equal(persistedIcon, reseeded.Icon);
        Assert.Equal("Base Services", reseeded.Name);
        Assert.Equal(10, reseeded.SortOrder);
        Assert.True(reseeded.IsActive);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"seeded-amenity-categories-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new KoochDbContext(options);
    }
}
