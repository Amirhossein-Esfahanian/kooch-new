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
}
