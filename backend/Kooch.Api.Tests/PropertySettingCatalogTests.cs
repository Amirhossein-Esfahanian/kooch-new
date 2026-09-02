using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySettingCatalogTests
{
    [Fact]
    public async Task DefaultCatalog_IsActiveOnlyAndDeterministicallyOrdered()
    {
        await using var context = CreateContext();
        context.PropertySettings.AddRange(
            Setting(1, "دوم", "second", 20),
            Setting(2, "ب", "same-b", 10),
            Setting(3, "الف", "same-a", 10),
            Setting(4, "غیرفعال", "inactive", 1, isActive: false),
            Setting(5, "حذف‌شده", "deleted", 0, isDeleted: true));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.GetCatalogAsync(includeInactive: false);

        Assert.Equal([3, 2, 1], result.Select(setting => setting.Id));
        Assert.All(result, setting => Assert.True(setting.IsActive));
    }

    [Fact]
    public async Task InactiveCatalog_IsAvailableOnlyWhenRequested_AndDeletedNeverAppears()
    {
        await using var context = CreateContext();
        context.PropertySettings.AddRange(
            Setting(1, "فعال", "active", 10),
            Setting(2, "غیرفعال", "inactive", 20, isActive: false),
            Setting(3, "حذف‌شده", "deleted", 30, isDeleted: true));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var result = await service.GetCatalogAsync(includeInactive: true);

        Assert.Equal([1, 2], result.Select(setting => setting.Id));
        Assert.DoesNotContain(result, setting => setting.Slug == "deleted");
    }

    [Fact]
    public async Task Create_TrimsNameNormalizesSlugAndRejectsDuplicateIncludingDeleted()
    {
        await using var context = CreateContext();
        context.PropertySettings.Add(Setting(1, "قدیمی", "historic-area", 10, isDeleted: true));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var duplicate = await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(new()
        {
            Name = "  بافت تاریخی  ",
            Slug = " Historic Area ",
            SortOrder = 20
        }));
        Assert.Equal("بافت و موقعیتی با این نامک از قبل وجود دارد.", duplicate.Message);
        Assert.Single(await context.PropertySettings.IgnoreQueryFilters().ToListAsync());

        var created = await service.CreateAsync(new()
        {
            Name = "  بافت تازه  ",
            Slug = " New Setting ",
            SortOrder = 30
        });
        Assert.Equal("بافت تازه", created.Name);
        Assert.Equal("new-setting", created.Slug);
    }

    [Theory]
    [InlineData("---")]
    [InlineData("بافت-تاریخی")]
    public async Task Create_RejectsSlugWithoutEnglishLettersOrDigits(string slug)
    {
        await using var context = CreateContext();
        var service = CreateService(context);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(new()
        {
            Name = "بافت تاریخی",
            Slug = slug,
            SortOrder = 10
        }));

        Assert.Equal("نامک باید شامل حروف انگلیسی یا عدد باشد.", exception.Message);
        Assert.Empty(await context.PropertySettings.ToListAsync());
    }

    [Fact]
    public async Task Update_ChangesAdminFieldsAndPreservesSlug()
    {
        await using var context = CreateContext();
        context.PropertySettings.Add(Setting(1, "قدیمی", "stable-slug", 10));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var updated = await service.UpdateAsync(1, new()
        {
            Name = "  نام تازه  ",
            SortOrder = 90,
            IsActive = false
        });

        Assert.Equal("نام تازه", updated.Name);
        Assert.Equal("stable-slug", updated.Slug);
        Assert.Equal(90, updated.SortOrder);
        Assert.False(updated.IsActive);
    }

    [Fact]
    public async Task Delete_UnassignedSettingSoftDeletesAndDeactivates()
    {
        await using var context = CreateContext();
        context.PropertySettings.Add(Setting(1, "قابل حذف", "deletable", 10));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await service.DeleteAsync(1);

        var deleted = await context.PropertySettings.IgnoreQueryFilters().SingleAsync();
        Assert.True(deleted.IsDeleted);
        Assert.False(deleted.IsActive);
        Assert.NotNull(deleted.DeletedAtUtc);
    }

    [Fact]
    public async Task Delete_SettingWithHistoricalAssignmentReturnsConflictWithoutMutation()
    {
        await using var context = CreateContext();
        var setting = Setting(1, "مرتبط", "assigned", 10);
        context.PropertySettings.Add(setting);
        context.PropertySettingAssignments.Add(new()
        {
            Id = 10,
            PropertyId = 99,
            PropertySettingId = 1,
            IsDeleted = true
        });
        await context.SaveChangesAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.DeleteAsync(1));

        var persisted = await context.PropertySettings.SingleAsync();
        Assert.False(persisted.IsDeleted);
        Assert.True(persisted.IsActive);
    }

    private static PropertySetting Setting(
        int id,
        string name,
        string slug,
        int sortOrder,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        Id = id,
        Name = name,
        Slug = slug,
        SortOrder = sortOrder,
        IsActive = isActive,
        IsDeleted = isDeleted
    };

    private static PropertySettingService CreateService(KoochDbContext context) =>
        new(context, new StubPropertyAccessService());

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"property-setting-catalog-{Guid.NewGuid():N}")
            .Options;
        return new KoochDbContext(options);
    }
}
