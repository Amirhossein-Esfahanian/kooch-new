using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySettingAssignmentTests
{
    [Fact]
    public async Task Replace_AssignsActiveSettingsDeduplicatesAndReturnsCatalogOrder()
    {
        await using var context = await CreateContextAsync();
        var service = CreateService(context);

        var result = await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new SetPropertySettingsRequest { PropertySettingIds = [1, 2, 1] });

        Assert.Equal([2, 1], result.Select(setting => setting.Id));
        Assert.Equal(2, await context.PropertySettingAssignments.CountAsync());
    }

    [Fact]
    public async Task Replace_SoftDeletesRemovedRetainsCurrentAndReactivatesOriginalRow()
    {
        await using var context = await CreateContextAsync();
        var service = CreateService(context);
        await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [1, 2] });
        var originalAId = (await context.PropertySettingAssignments
            .SingleAsync(assignment => assignment.PropertySettingId == 1)).Id;
        context.ChangeTracker.Clear();

        await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [2, 3] });

        var afterReplace = await context.PropertySettingAssignments.IgnoreQueryFilters()
            .OrderBy(assignment => assignment.PropertySettingId)
            .ToListAsync();
        Assert.True(afterReplace.Single(assignment => assignment.PropertySettingId == 1).IsDeleted);
        Assert.False(afterReplace.Single(assignment => assignment.PropertySettingId == 2).IsDeleted);
        Assert.False(afterReplace.Single(assignment => assignment.PropertySettingId == 3).IsDeleted);
        context.ChangeTracker.Clear();

        await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [] });
        Assert.Empty(await context.PropertySettingAssignments.ToListAsync());
        context.ChangeTracker.Clear();

        await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [1] });
        var allRows = await context.PropertySettingAssignments.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(3, allRows.Count);
        var reactivated = allRows.Single(assignment => assignment.PropertySettingId == 1);
        Assert.Equal(originalAId, reactivated.Id);
        Assert.False(reactivated.IsDeleted);
        Assert.Null(reactivated.DeletedAtUtc);
        Assert.Null(reactivated.DeletedByUserId);
    }

    [Fact]
    public async Task InactiveSetting_CanRemainOrBeRemovedButCannotBeNewlyAssigned()
    {
        await using var context = await CreateContextAsync();
        context.PropertySettingAssignments.Add(new()
        {
            Id = 20,
            PropertyId = 10,
            PropertySettingId = 4
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var service = CreateService(context);

        var current = await service.GetPropertySettingsAsync(1, UserRole.Client, 10);
        Assert.Collection(current, setting =>
        {
            Assert.Equal(4, setting.Id);
            Assert.False(setting.IsActive);
        });

        var preserved = await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [4] });
        Assert.Single(preserved);

        var removed = await service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [] });
        Assert.Empty(removed);
        context.ChangeTracker.Clear();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.ReplacePropertySettingsAsync(
                1, UserRole.Client, 10, new() { PropertySettingIds = [4] }));
        Assert.Equal("بافت و موقعیت غیرفعال را نمی‌توان به اقامتگاه افزود.", exception.Message);
        Assert.Empty(await context.PropertySettingAssignments.ToListAsync());
    }

    [Theory]
    [InlineData(5)]
    [InlineData(999)]
    [InlineData(0)]
    public async Task InvalidRequest_IsRejectedAtomically(int invalidId)
    {
        await using var context = await CreateContextAsync();
        context.PropertySettingAssignments.Add(new()
        {
            Id = 30,
            PropertyId = 10,
            PropertySettingId = 1
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var service = CreateService(context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 10, new() { PropertySettingIds = [2, invalidId] }));

        var assignments = await context.PropertySettingAssignments.IgnoreQueryFilters().ToListAsync();
        var existing = Assert.Single(assignments);
        Assert.Equal(1, existing.PropertySettingId);
        Assert.False(existing.IsDeleted);
    }

    [Fact]
    public async Task UnrelatedOwner_CannotReadOrReplaceAnotherPropertySettings()
    {
        await using var context = await CreateContextAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetPropertySettingsAsync(2, UserRole.Client, 10));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ReplacePropertySettingsAsync(
                2, UserRole.Client, 10, new() { PropertySettingIds = [1] }));
        Assert.Empty(await context.PropertySettingAssignments.ToListAsync());
    }

    [Fact]
    public async Task MissingProperty_IsRejectedBeforeAssignmentMutation()
    {
        await using var context = await CreateContextAsync();
        var service = CreateService(context);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.ReplacePropertySettingsAsync(
            1, UserRole.Client, 404, new() { PropertySettingIds = [1] }));
        Assert.Empty(await context.PropertySettingAssignments.ToListAsync());
    }

    private static PropertySettingService CreateService(KoochDbContext context) =>
        new(context, new StubPropertyAccessService(
            canView: (userId, propertyId) => userId == 1 && propertyId == 10,
            canManage: (userId, propertyId) => userId == 1 && propertyId == 10));

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"property-setting-assignment-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);
        context.Properties.Add(new Property
        {
            Id = 10,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "IR"
        });
        context.PropertySettings.AddRange(
            Setting(1, "الف", "a", 20),
            Setting(2, "ب", "b", 10),
            Setting(3, "ج", "c", 30),
            Setting(4, "غیرفعال", "inactive", 40, isActive: false),
            Setting(5, "حذف‌شده", "deleted", 50, isDeleted: true));
        await context.SaveChangesAsync();
        return context;
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
}

internal sealed class StubPropertyAccessService(
    Func<int, int, bool>? canView = null,
    Func<int, int, bool>? canManage = null) : IPropertyAccessService
{
    public Task<bool> CanViewAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(canView?.Invoke(userId, propertyId) ?? true);

    public Task<bool> CanManagePropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(canManage?.Invoke(userId, propertyId) ?? true);

    public Task<bool> CanManageRoomsAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(false);

    public Task<bool> CanManageAvailabilityAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(false);

    public Task<bool> CanManagePricingAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(false);
}
