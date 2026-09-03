using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicPropertyVisibilityTests
{
    [Fact]
    public async Task PublicLists_DoNotApplyAnImplicitCityFilter()
    {
        await using var context = CreateContext();
        context.Properties.AddRange(
            Property(1, "English city", "english-city", "Kashan"),
            Property(2, "Persian city", "persian-city", "کاشان"),
            Property(3, "Other city", "other-city", "شیراز"));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var properties = await service.GetPublicPropertiesAsync();
        var suggestions = await service.GetPublicPropertySuggestionsAsync();

        Assert.Equal([1, 2, 3], properties.Select(item => item.Id).Order());
        Assert.Equal([1, 2, 3], suggestions.Select(item => item.Id).Order());
    }

    [Fact]
    public async Task PublicLists_ApplyCityFilterOnlyWhenExplicitlyProvided()
    {
        await using var context = CreateContext();
        context.Properties.AddRange(
            Property(1, "English city", "english-city", "Kashan"),
            Property(2, "Persian city", "persian-city", "کاشان"),
            Property(3, "Other city", "other-city", "شیراز"));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var properties = await service.GetPublicPropertiesAsync(city: " کاشان ");
        var suggestions = await service.GetPublicPropertySuggestionsAsync(city: " کاشان ");

        Assert.Equal(2, Assert.Single(properties).Id);
        Assert.Equal(2, Assert.Single(suggestions).Id);
    }

    [Fact]
    public async Task PublicDetail_IncludesOnlyActiveNonDeletedSettingsInDeterministicOrder()
    {
        await using var context = CreateContext();
        context.Properties.Add(Property(1, "Property", "property", "کاشان"));
        context.PropertySettings.AddRange(
            Setting(1, "دوم", "second", 20),
            Setting(2, "ب", "same-b", 10),
            Setting(3, "الف", "same-a", 10),
            Setting(4, "غیرفعال", "inactive", 1, isActive: false),
            Setting(5, "حذف‌شده", "deleted", 0, isDeleted: true));
        context.PropertySettingAssignments.AddRange(
            Assignment(1, 1),
            Assignment(2, 2),
            Assignment(3, 3),
            Assignment(4, 4),
            Assignment(5, 5),
            Assignment(6, 1, isDeleted: true));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var property = await service.GetPublicPropertyBySlugAsync("property");

        Assert.NotNull(property);
        Assert.Equal(
            [(3, "الف", "same-a"), (2, "ب", "same-b"), (1, "دوم", "second")],
            property.Settings.Select(setting => (setting.Id, setting.Name, setting.Slug)));
    }

    [Fact]
    public async Task PublicLists_PropertySettingFilterUsesDistinctSlugOrSemantics()
    {
        await using var context = CreateContext();
        context.Properties.AddRange(
            Property(1, "Historic", "historic", "کاشان"),
            Property(2, "Bazaar", "bazaar", "کاشان"),
            Property(3, "Inactive only", "inactive-only", "کاشان"),
            Property(4, "Deleted assignment", "deleted-assignment", "کاشان"),
            Property(5, "Deleted setting", "deleted-setting", "کاشان"));
        context.PropertySettings.AddRange(
            Setting(1, "بافت تاریخی", "historic-district", 10),
            Setting(2, "محدوده بازار", "bazaar-area", 20),
            Setting(3, "غیرفعال", "inactive", 30, isActive: false),
            Setting(4, "حذف‌شده", "deleted", 40, isDeleted: true));
        context.PropertySettingAssignments.AddRange(
            AssignmentForProperty(1, 1, 1),
            AssignmentForProperty(2, 2, 2),
            AssignmentForProperty(3, 3, 3),
            AssignmentForProperty(4, 4, 1, isDeleted: true),
            AssignmentForProperty(5, 5, 4));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var properties = await service.GetPublicPropertiesAsync(
            settingSlugs: " historic-district,BAZAAR-area,historic-district,unknown ");

        Assert.Equal([1, 2], properties.Select(property => property.Id).Order());
    }

    [Fact]
    public async Task PublicLists_UnknownPropertySettingSlugReturnsNoMatches()
    {
        await using var context = CreateContext();
        context.Properties.Add(Property(1, "Property", "property", "کاشان"));
        context.PropertySettings.Add(Setting(1, "بافت تاریخی", "historic-district", 10));
        context.PropertySettingAssignments.Add(AssignmentForProperty(1, 1, 1));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var properties = await service.GetPublicPropertiesAsync(
            settingSlugs: "unknown-setting");

        Assert.Empty(properties);
    }

    [Fact]
    public async Task PublicLists_EmptyPropertySettingFilterDoesNotRestrictResults()
    {
        await using var context = CreateContext();
        context.Properties.AddRange(
            Property(1, "With setting", "with-setting", "کاشان"),
            Property(2, "Without setting", "without-setting", "کاشان"));
        context.PropertySettings.Add(Setting(1, "بافت تاریخی", "historic-district", 10));
        context.PropertySettingAssignments.Add(AssignmentForProperty(1, 1, 1));
        await context.SaveChangesAsync();
        var service = CreateService(context);

        var properties = await service.GetPublicPropertiesAsync(settingSlugs: " , ");

        Assert.Equal([1, 2], properties.Select(property => property.Id).Order());
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static PropertyService CreateService(KoochDbContext context) =>
        new(
            context,
            null!,
            null!,
            null!,
            null!,
            new ChildPricingRuleResolver(context));

    private static Property Property(int id, string name, string slug, string city) =>
        new()
        {
            Id = id,
            OwnerId = 1,
            DestinationId = 1,
            Name = name,
            Slug = slug,
            Description = "Description",
            Address = "Address",
            City = city,
            Country = "IR",
            Status = PropertyStatus.Approved
        };

    private static PropertySetting Setting(
        int id,
        string name,
        string slug,
        int sortOrder,
        bool isActive = true,
        bool isDeleted = false) =>
        new()
        {
            Id = id,
            Name = name,
            Slug = slug,
            SortOrder = sortOrder,
            IsActive = isActive,
            IsDeleted = isDeleted
        };

    private static PropertySettingAssignment Assignment(
        int id,
        int settingId,
        bool isDeleted = false) =>
        new()
        {
            Id = id,
            PropertyId = 1,
            PropertySettingId = settingId,
            IsDeleted = isDeleted
        };

    private static PropertySettingAssignment AssignmentForProperty(
        int id,
        int propertyId,
        int settingId,
        bool isDeleted = false) =>
        new()
        {
            Id = id,
            PropertyId = propertyId,
            PropertySettingId = settingId,
            IsDeleted = isDeleted
        };
}
