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
}
