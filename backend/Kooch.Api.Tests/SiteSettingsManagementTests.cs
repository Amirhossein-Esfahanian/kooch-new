using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SiteSettingsManagementTests
{
    private const int PropertyId = 101;

    [Fact]
    public void ManagementEndpoint_UsesTheExistingOwnerPolicy()
    {
        var method = typeof(SiteSettingsController).GetMethod(nameof(SiteSettingsController.GetManagement));
        var attribute = Assert.Single(method!.GetCustomAttributes<OwnerAuthorizeAttribute>());

        Assert.Equal(AuthorizationPolicies.OwnerUsers, attribute.Policy);
    }

    [Fact]
    public async Task ManagementGet_ReturnsExactlyTheSixAllowedActiveNonDeletedSettings()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting("image.maxFileSizeMb", "2"),
            Setting("image.minWidth", "800"),
            Setting("image.minHeight", "600"),
            Setting("image.maxImagesPerProperty", "30"),
            Setting("pricing.minPrice", "100000"),
            Setting("pricing.maxPrice", "50000000"),
            Setting("site.name", "Kooch"),
            Setting("pricing.currencyLabel", "تومان"),
            Setting("image.enableWebpConversion", "true"),
            Setting("reservation.paymentWindowMinutes", "10"),
            Setting("ReservationCommissionPercent", "5"));
        await dbContext.SaveChangesAsync();

        var settings = await GetManagementAsync(new SiteSettingsController(dbContext));

        Assert.Equal(6, settings.Count);
        Assert.Equal(
            [
                "image.maxFileSizeMb",
                "image.maxImagesPerProperty",
                "image.minHeight",
                "image.minWidth",
                "pricing.maxPrice",
                "pricing.minPrice"
            ],
            settings.Keys.Order().ToArray());
        Assert.DoesNotContain("site.name", settings.Keys);
        Assert.DoesNotContain("pricing.currencyLabel", settings.Keys);
        Assert.DoesNotContain("image.enableWebpConversion", settings.Keys);
        Assert.DoesNotContain("reservation.paymentWindowMinutes", settings.Keys);
        Assert.DoesNotContain("ReservationCommissionPercent", settings.Keys);
    }

    [Fact]
    public async Task ManagementGet_OmitsInactiveDeletedAndMissingKeysAndPreservesMalformedRawValues()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting("image.maxFileSizeMb", "not-a-number"),
            Setting("image.minWidth", "800", isActive: false),
            Setting("image.minHeight", "600", isDeleted: true));
        await dbContext.SaveChangesAsync();

        var settings = await GetManagementAsync(new SiteSettingsController(dbContext));

        var setting = Assert.Single(settings);
        Assert.Equal("image.maxFileSizeMb", setting.Key);
        Assert.Equal("not-a-number", setting.Value);
        Assert.DoesNotContain("image.minWidth", settings.Keys);
        Assert.DoesNotContain("image.minHeight", settings.Keys);
        Assert.DoesNotContain("image.maxImagesPerProperty", settings.Keys);
    }

    [Fact]
    public async Task OwnerPolicy_AllowsSuperAdminAndActivePropertyOperator()
    {
        await using var dbContext = await CreateAuthorizationContextAsync();

        Assert.True(await OwnerPolicySucceedsAsync(dbContext, 1, UserRole.SuperAdmin));
        Assert.True(await OwnerPolicySucceedsAsync(dbContext, 2, UserRole.Client));
    }

    [Fact]
    public async Task OwnerPolicy_RejectsAnonymousOrdinaryClientAndInactiveOrSuspendedMemberships()
    {
        await using var dbContext = await CreateAuthorizationContextAsync();

        Assert.False(await OwnerPolicySucceedsAsync(dbContext, new ClaimsPrincipal(new ClaimsIdentity())));
        Assert.False(await OwnerPolicySucceedsAsync(dbContext, 3, UserRole.Client));
        Assert.False(await OwnerPolicySucceedsAsync(dbContext, 4, UserRole.Client));
        Assert.False(await OwnerPolicySucceedsAsync(dbContext, 5, UserRole.Client));
    }

    [Fact]
    public async Task OwnerPolicy_AdminAssistantUsesExistingMembershipAndPlatformPermissionLimits()
    {
        await using var dbContext = await CreateAuthorizationContextAsync();

        Assert.True(await OwnerPolicySucceedsAsync(dbContext, 6, UserRole.AdminAssistant));
        Assert.False(await OwnerPolicySucceedsAsync(dbContext, 7, UserRole.AdminAssistant));
        Assert.False(await OwnerPolicySucceedsAsync(dbContext, 8, UserRole.AdminAssistant));
    }

    private static async Task<Dictionary<string, string>> GetManagementAsync(
        SiteSettingsController controller)
    {
        var response = await controller.GetManagement(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        return Assert.IsType<Dictionary<string, string>>(ok.Value);
    }

    private static SiteSetting Setting(
        string key,
        string value,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        Key = key,
        Value = value,
        Type = SiteSettingType.Text,
        Group = "Tests",
        Label = key,
        SortOrder = 10,
        IsActive = isActive,
        IsDeleted = isDeleted
    };

    private static async Task<KoochDbContext> CreateAuthorizationContextAsync()
    {
        var dbContext = CreateContext();
        dbContext.Users.AddRange(
            User(1, UserRole.SuperAdmin, "super-admin"),
            User(2, UserRole.Client, "operator"),
            User(3, UserRole.Client, "ordinary-client"),
            User(4, UserRole.Client, "inactive-member"),
            User(5, UserRole.Client, "suspended-member"),
            User(6, UserRole.AdminAssistant, "allowed-assistant"),
            User(7, UserRole.AdminAssistant, "assistant-without-permission"),
            User(8, UserRole.AdminAssistant, "assistant-without-membership"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 10,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = PropertyId,
            OwnerId = 3,
            DestinationId = 10,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.UserPropertyAccesses.AddRange(
            Membership(100, 2),
            Membership(101, 4, PropertyUserStatus.Inactive, isActive: false),
            Membership(102, 5, PropertyUserStatus.Suspended, isActive: false),
            Membership(103, 6),
            Membership(104, 7));
        dbContext.Permissions.Add(new Permission
        {
            Id = 200,
            Key = PermissionKey.ManageProperties,
            Name = nameof(PermissionKey.ManageProperties)
        });
        dbContext.UserPermissions.Add(new UserPermission
        {
            Id = 300,
            UserId = 6,
            PermissionKey = PermissionKey.ManageProperties,
            IsAllowed = true
        });

        await dbContext.SaveChangesAsync();
        return dbContext;
    }

    private static User User(int id, UserRole role, string name) => new()
    {
        Id = id,
        FirstName = name,
        LastName = "user",
        Email = $"{name}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private static UserPropertyAccess Membership(
        int id,
        int userId,
        PropertyUserStatus status = PropertyUserStatus.Active,
        bool isActive = true) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = PropertyId,
        PropertyRole = PropertyUserRole.Manager,
        Status = status,
        IsActive = isActive,
        PermissionMatrixJson = PropertiesViewPermissionJson
    };

    private static async Task<bool> OwnerPolicySucceedsAsync(
        KoochDbContext dbContext,
        int userId,
        UserRole role) =>
        await OwnerPolicySucceedsAsync(
            dbContext,
            new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim(ClaimTypes.Role, role.ToString())
                ],
                "SiteSettingsManagementTests")));

    private static async Task<bool> OwnerPolicySucceedsAsync(
        KoochDbContext dbContext,
        ClaimsPrincipal principal)
    {
        var requirement = new OwnerPanelAccessRequirement();
        var authorizationContext = new AuthorizationHandlerContext(
            [requirement],
            principal,
            resource: null);
        var handler = new OwnerPanelAccessAuthorizationHandler(new PropertyAccessService(dbContext));

        await handler.HandleAsync(authorizationContext);

        return authorizationContext.HasSucceeded;
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"site-settings-management-{Guid.NewGuid():N}")
            .Options;
        return new KoochDbContext(options);
    }

    private const string PropertiesViewPermissionJson =
        """
        {
          "Properties": {
            "View": true,
            "Create": false,
            "Edit": false,
            "Delete": false,
            "Export": false
          }
        }
        """;
}
