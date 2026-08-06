using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyCommonAreaTests
{
    [Fact]
    public void Controller_MapsCollectionReadsAndReplacementToTheOwnerPropertyRoute()
    {
        var controllerType = typeof(OwnerPropertyCommonAreasController);
        var route = Assert.Single(controllerType.GetCustomAttributes(typeof(RouteAttribute), false).Cast<RouteAttribute>());
        Assert.Equal("api/owner/properties/{propertyId:int}/common-areas", route.Template);

        var actions = controllerType.GetMethods()
            .Where(method => method.DeclaringType == controllerType)
            .ToDictionary(method => method.Name);

        Assert.NotNull(actions[nameof(OwnerPropertyCommonAreasController.Get)]
            .GetCustomAttributes(typeof(HttpGetAttribute), false).SingleOrDefault());
        Assert.NotNull(actions[nameof(OwnerPropertyCommonAreasController.Replace)]
            .GetCustomAttributes(typeof(HttpPutAttribute), false).SingleOrDefault());
        Assert.DoesNotContain(actions.Values, method =>
            method.GetCustomAttributes(typeof(HttpPostAttribute), false).Length > 0 ||
            method.GetCustomAttributes(typeof(HttpDeleteAttribute), false).Length > 0);
    }

    [Fact]
    public async Task Replace_CreatesUpdatesAndDeletesThePropertyCommonAreaCollection()
    {
        await using var context = await CreateContextAsync();
        var service = new PropertyCommonAreaService(context, new PropertyAccessService(context));

        var created = await service.ReplaceAsync(1, UserRole.SuperAdmin, 100, new ReplacePropertyCommonAreasRequest
        {
            CommonAreas =
            [
                new PropertyCommonAreaRequest { Name = "  حیاط مرکزی  ", Description = "  کنار حوض  ", SortOrder = 1 },
                new PropertyCommonAreaRequest { Name = "بام", SortOrder = 2 }
            ]
        });

        Assert.Equal(2, created.Count);
        Assert.Equal("حیاط مرکزی", created[0].Name);
        Assert.Equal("کنار حوض", created[0].Description);

        var replaced = await service.ReplaceAsync(1, UserRole.SuperAdmin, 100, new ReplacePropertyCommonAreasRequest
        {
            CommonAreas =
            [
                new PropertyCommonAreaRequest { Name = "حیاط مرکزی", Description = "توضیح جدید", SortOrder = 1 }
            ]
        });

        var updated = Assert.Single(replaced);
        Assert.Equal("توضیح جدید", updated.Description);
        Assert.Single(await context.PropertyCommonAreas.ToListAsync());

        var deleted = await service.ReplaceAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new ReplacePropertyCommonAreasRequest());

        Assert.Empty(deleted);
        Assert.Empty(await context.PropertyCommonAreas.ToListAsync());
    }

    [Fact]
    public async Task CommonAreas_RequirePropertyScopedAuthorizationForReadAndReplace()
    {
        await using var context = await CreateContextAsync();
        var service = new PropertyCommonAreaService(context, new PropertyAccessService(context));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetAsync(2, UserRole.Client, 100));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ReplaceAsync(2, UserRole.Client, 100, new ReplacePropertyCommonAreasRequest
            {
                CommonAreas = [new PropertyCommonAreaRequest { Name = "حیاط" }]
            }));
        Assert.Empty(await context.PropertyCommonAreas.ToListAsync());
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"property-common-areas-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);

        context.Users.AddRange(
            new User
            {
                Id = 1,
                FirstName = "مدیر",
                LastName = "سیستم",
                PasswordHash = "hash",
                Role = UserRole.SuperAdmin,
                IsActive = true
            },
            new User
            {
                Id = 2,
                FirstName = "کاربر",
                LastName = "مهمان",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            });
        context.Destinations.Add(new Destination
        {
            Id = 50,
            Name = "کاشان",
            Slug = "kashan",
            Country = "IR"
        });
        context.Properties.Add(new Property
        {
            Id = 100,
            OwnerId = 1,
            DestinationId = 50,
            Name = "سرای آزمون",
            Slug = "test-property",
            Description = "توضیحات",
            Address = "نشانی",
            City = "کاشان",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        await context.SaveChangesAsync();
        return context;
    }
}
