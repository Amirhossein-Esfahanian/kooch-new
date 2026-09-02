using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SeedDataPropertySettingTests
{
    private static readonly (string Name, string Slug, int SortOrder)[] ExpectedSettings =
    [
        ("بافت تاریخی", "historic-district", 10),
        ("محدوده بازار", "bazaar-area", 20),
        ("بافت روستایی", "rural-setting", 30),
        ("بافت کویری", "desert-setting", 40),
        ("مرکز شهر", "city-center", 50),
        ("منطقه کوهستانی", "mountainous-area", 60),
        ("بافت مسکونی", "residential-area", 70),
        ("حاشیه شهر", "city-outskirts", 80)
    ];

    [Fact]
    public async Task EmptyDatabase_CreatesCompleteInitialCatalog()
    {
        await using var context = CreateContext();

        await SeedData.InitializeAsync(context);
        context.ChangeTracker.Clear();

        var settings = await context.PropertySettings
            .OrderBy(setting => setting.SortOrder)
            .Select(setting => new { setting.Name, setting.Slug, setting.SortOrder, setting.IsActive })
            .ToListAsync();

        Assert.Equal(ExpectedSettings.Length, settings.Count);
        Assert.Equal(ExpectedSettings.Select(item => item.Name), settings.Select(item => item.Name));
        Assert.Equal(ExpectedSettings.Select(item => item.Slug), settings.Select(item => item.Slug));
        Assert.Equal(ExpectedSettings.Select(item => item.SortOrder), settings.Select(item => item.SortOrder));
        Assert.All(settings, setting => Assert.True(setting.IsActive));
    }

    [Fact]
    public async Task SecondSeedRun_PreservesIdsAndDoesNotCreateDuplicates()
    {
        await using var context = CreateContext();
        await SeedData.InitializeAsync(context);
        var firstIds = await context.PropertySettings
            .OrderBy(setting => setting.Slug)
            .Select(setting => setting.Id)
            .ToArrayAsync();
        context.ChangeTracker.Clear();

        await SeedData.InitializeAsync(context);
        context.ChangeTracker.Clear();

        var settings = await context.PropertySettings.IgnoreQueryFilters()
            .OrderBy(setting => setting.Slug)
            .ToListAsync();
        Assert.Equal(ExpectedSettings.Length, settings.Count);
        Assert.Equal(firstIds, settings.Select(setting => setting.Id));
        Assert.Equal(settings.Count, settings.Select(setting => setting.Slug).Distinct().Count());
    }

    [Fact]
    public async Task ExistingSlugWithNonstandardId_IsMatchedWithoutOverwritingAdminOwnedState()
    {
        await using var context = CreateContext();
        var deletedAt = new DateTime(2026, 8, 1, 12, 30, 0, DateTimeKind.Utc);
        context.PropertySettings.Add(new PropertySetting
        {
            Id = 513,
            Name = "نام مدیریت‌شده",
            Slug = "historic-district",
            SortOrder = 913,
            IsActive = false,
            IsDeleted = true,
            DeletedAtUtc = deletedAt,
            DeletedByUserId = 77,
            CreatedByUserId = 61
        });
        await context.SaveChangesAsync();
        var createdAt = (await context.PropertySettings.IgnoreQueryFilters()
            .SingleAsync(setting => setting.Id == 513)).CreatedAtUtc;
        context.ChangeTracker.Clear();

        await SeedData.InitializeAsync(context);
        context.ChangeTracker.Clear();

        var persisted = await context.PropertySettings.IgnoreQueryFilters()
            .SingleAsync(setting => setting.Slug == "historic-district");
        Assert.Equal(513, persisted.Id);
        Assert.Equal("نام مدیریت‌شده", persisted.Name);
        Assert.Equal(913, persisted.SortOrder);
        Assert.False(persisted.IsActive);
        Assert.True(persisted.IsDeleted);
        Assert.Equal(deletedAt, persisted.DeletedAtUtc);
        Assert.Equal(77, persisted.DeletedByUserId);
        Assert.Equal(61, persisted.CreatedByUserId);
        Assert.Equal(createdAt, persisted.CreatedAtUtc);
        Assert.Equal(ExpectedSettings.Length, await context.PropertySettings.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task MissingSeedSlugOnLaterRun_IsCreatedNormally()
    {
        await using var context = CreateContext();
        await SeedData.InitializeAsync(context);
        var removed = await context.PropertySettings.SingleAsync(setting => setting.Slug == "city-outskirts");
        context.PropertySettings.Remove(removed);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        await SeedData.InitializeAsync(context);
        context.ChangeTracker.Clear();

        var restored = await context.PropertySettings.SingleAsync(setting => setting.Slug == "city-outskirts");
        Assert.Equal("حاشیه شهر", restored.Name);
        Assert.Equal(80, restored.SortOrder);
        Assert.True(restored.IsActive);
        Assert.Equal(ExpectedSettings.Length, await context.PropertySettings.CountAsync());
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"seeded-property-settings-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new KoochDbContext(options);
    }
}
