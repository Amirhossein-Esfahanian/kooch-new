using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AuthorizationCharacterizationTests
{
    private const int SuperAdminId = 1;
    private const int AdminAssistantId = 2;
    private const int PropertyOwnerId = 3;
    private const int PropertyAssistantId = 4;
    private const int ClientId = 5;
    private const int OtherOwnerId = 6;
    private const int FirstPropertyId = 101;
    private const int OtherPropertyId = 202;

    public static TheoryData<int, UserRole> ActiveRoles => new()
    {
        { SuperAdminId, UserRole.SuperAdmin },
        { AdminAssistantId, UserRole.AdminAssistant },
        { PropertyOwnerId, UserRole.Owner },
        { PropertyAssistantId, UserRole.OwnerAssistant },
        { ClientId, UserRole.Client }
    };

    [Theory]
    [MemberData(nameof(ActiveRoles))]
    public async Task AuthMe_ReturnsCurrentActiveUser(int userId, UserRole role)
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateAuthController(dbContext, userId, role);

        var response = await controller.Me(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var currentUser = Assert.IsType<CurrentUserResponse>(ok.Value);
        Assert.Equal(userId, currentUser.UserId);
        Assert.Equal(role.ToCanonicalPlatformRole(), currentUser.PlatformRole);
    }

    [Fact]
    public async Task OwnerProperties_ReturnsAllPropertiesForSuperAdmin()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            SuperAdminId,
            UserRole.SuperAdmin);

        var properties = await GetMineAsync(controller);

        Assert.Equal([FirstPropertyId, OtherPropertyId], properties.Select(item => item.Id).Order().ToArray());
    }

    [Fact]
    public async Task OwnerProperties_DeniesAdminAssistantWithoutExplicitPropertyMembership()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            AdminAssistantId,
            UserRole.AdminAssistant);

        var properties = await GetMineAsync(controller);

        Assert.Empty(properties);
        Assert.False(await OwnerPolicySucceedsAsync(
            dbContext,
            AdminAssistantId,
            UserRole.AdminAssistant));
    }

    [Fact]
    public async Task OwnerProperties_ReturnsOnlyOwnedPropertyForPropertyOwner()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            PropertyOwnerId,
            UserRole.Owner);

        var properties = await GetMineAsync(controller);

        Assert.Collection(properties, property => Assert.Equal(FirstPropertyId, property.Id));
    }

    [Fact]
    public async Task OwnerProperties_ReturnsOnlyActiveMembershipForPropertyAssistant()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant);

        var properties = await GetMineAsync(controller);

        Assert.Collection(properties, property => Assert.Equal(FirstPropertyId, property.Id));
    }

    [Fact]
    public async Task NormalClient_IsDeniedByOwnerPolicyAndHasNoOwnerProperties()
    {
        await using var dbContext = await CreateSeededContextAsync();

        Assert.False(await OwnerPolicySucceedsAsync(dbContext, ClientId, UserRole.Client));

        var controller = CreateOwnerPropertiesController(dbContext, ClientId, UserRole.Client);
        Assert.Empty(await GetMineAsync(controller));
    }

    [Fact]
    public async Task PropertyOwner_CanAccessOwnedPropertyButNotAnotherProperty()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            PropertyOwnerId,
            UserRole.Owner);

        var ownedProperty = await GetByIdAsync(controller, FirstPropertyId);

        Assert.Equal(FirstPropertyId, ownedProperty.Id);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => controller.GetById(OtherPropertyId, CancellationToken.None));
    }

    [Fact]
    public async Task PropertyAssistant_CanAccessAssignedPropertyButNotAnotherProperty()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var controller = CreateOwnerPropertiesController(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant);

        var assignedProperty = await GetByIdAsync(controller, FirstPropertyId);

        Assert.Equal(FirstPropertyId, assignedProperty.Id);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => controller.GetById(OtherPropertyId, CancellationToken.None));
    }

    [Fact]
    public async Task AdminAssistantWithoutManageProperties_HasNoOwnerPolicyOrDirectAccess()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var permission = await dbContext.UserPermissions.SingleAsync(item =>
            item.UserId == AdminAssistantId &&
            item.PermissionKey == PermissionKey.ManageProperties);
        dbContext.UserPermissions.Remove(permission);
        await dbContext.SaveChangesAsync();

        Assert.False(await OwnerPolicySucceedsAsync(
            dbContext,
            AdminAssistantId,
            UserRole.AdminAssistant));

        var controller = CreateOwnerPropertiesController(
            dbContext,
            AdminAssistantId,
            UserRole.AdminAssistant);
        Assert.Empty(await GetMineAsync(controller));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => controller.GetById(OtherPropertyId, CancellationToken.None));
    }

    [Fact]
    public async Task InactiveMembership_IsExcludedAndLegacyOwnerAssistantRoleDoesNotPassOwnerPolicy()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(item =>
            item.UserId == PropertyAssistantId && item.PropertyId == FirstPropertyId);
        membership.Status = PropertyUserStatus.Inactive;
        membership.IsActive = false;
        await dbContext.SaveChangesAsync();

        Assert.False(await OwnerPolicySucceedsAsync(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant));

        var controller = CreateOwnerPropertiesController(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant);
        Assert.Empty(await GetMineAsync(controller));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => controller.GetById(FirstPropertyId, CancellationToken.None));
    }

    [Fact]
    public async Task InactiveUser_IsRejectedByAuthMeAndPropertyAuthorization()
    {
        await using var dbContext = await CreateSeededContextAsync();
        var user = await dbContext.Users.SingleAsync(item => item.Id == PropertyAssistantId);
        user.IsActive = false;
        await dbContext.SaveChangesAsync();

        var authController = CreateAuthController(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant);
        var me = await authController.Me(CancellationToken.None);
        Assert.IsType<UnauthorizedResult>(me.Result);

        Assert.False(await OwnerPolicySucceedsAsync(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant));

        var ownerController = CreateOwnerPropertiesController(
            dbContext,
            PropertyAssistantId,
            UserRole.OwnerAssistant);
        Assert.Empty(await GetMineAsync(ownerController));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => ownerController.GetById(FirstPropertyId, CancellationToken.None));
    }

    private static async Task<KoochDbContext> CreateSeededContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var dbContext = new KoochDbContext(options);

        var users = new[]
        {
            CreateUser(SuperAdminId, UserRole.SuperAdmin, "superadmin"),
            CreateUser(AdminAssistantId, UserRole.AdminAssistant, "admin-assistant"),
            CreateUser(PropertyOwnerId, UserRole.Owner, "property-owner"),
            CreateUser(PropertyAssistantId, UserRole.OwnerAssistant, "property-assistant"),
            CreateUser(ClientId, UserRole.Client, "client"),
            CreateUser(OtherOwnerId, UserRole.Owner, "other-owner")
        };
        dbContext.Users.AddRange(users);

        var destination = new Destination
        {
            Id = 10,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        };
        dbContext.Destinations.Add(destination);
        dbContext.Properties.AddRange(
            CreateProperty(FirstPropertyId, PropertyOwnerId, destination.Id, "First property"),
            CreateProperty(OtherPropertyId, OtherOwnerId, destination.Id, "Other property"));

        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(1001, PropertyOwnerId, FirstPropertyId, PropertyUserRole.PropertyOwner),
            CreateMembership(1002, OtherOwnerId, OtherPropertyId, PropertyUserRole.PropertyOwner),
            CreateMembership(1003, PropertyAssistantId, FirstPropertyId, PropertyUserRole.Manager));

        dbContext.Permissions.Add(new Permission
        {
            Id = 2001,
            Key = PermissionKey.ManageProperties,
            Name = nameof(PermissionKey.ManageProperties)
        });
        dbContext.UserPermissions.Add(new UserPermission
        {
            Id = 3001,
            UserId = AdminAssistantId,
            PermissionKey = PermissionKey.ManageProperties,
            IsAllowed = true
        });

        await dbContext.SaveChangesAsync();
        return dbContext;
    }

    private static User CreateUser(int id, UserRole role, string identifier) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = "not-used-in-characterization-tests",
        Role = role,
        IsActive = true
    };

    private static UserPropertyAccess CreateMembership(
        int id,
        int userId,
        int propertyId,
        PropertyUserRole propertyRole) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = propertyRole,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = DashboardViewPermissionJson
    };

    private static Property CreateProperty(
        int id,
        int ownerId,
        int destinationId,
        string name) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = destinationId,
        Name = name,
        Slug = name.Replace(' ', '-').ToLowerInvariant(),
        Description = name,
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private static AuthController CreateAuthController(
        KoochDbContext dbContext,
        int userId,
        UserRole role)
    {
        var authService = new AuthService(
            dbContext,
            Options.Create(new JwtOptions
            {
                Key = "characterization-tests-key-32-bytes-minimum",
                Issuer = "Kooch.Tests",
                Audience = "Kooch.Tests",
                ExpiresMinutes = 60,
                AccessTokenExpirationDays = 30
            }),
            new PropertyAccessService(dbContext),
            null!,
            null!);
        var controller = new AuthController(authService);
        SetCurrentUser(controller, userId, role);
        return controller;
    }

    private static OwnerPropertiesController CreateOwnerPropertiesController(
        KoochDbContext dbContext,
        int userId,
        UserRole role)
    {
        var propertyAccessService = new PropertyAccessService(dbContext);
        var permissionService = new PermissionService(dbContext, propertyAccessService);
        var propertyService = new PropertyService(
            dbContext,
            propertyAccessService,
            propertyAccessService,
            permissionService,
            null!,
            null!);
        var controller = new OwnerPropertiesController(propertyService, null!);
        SetCurrentUser(controller, userId, role);
        return controller;
    }

    private static void SetCurrentUser(ControllerBase controller, int userId, UserRole role)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = CreatePrincipal(userId, role)
            }
        };
    }

    private static ClaimsPrincipal CreatePrincipal(int userId, UserRole role) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, role.ToString())
            ],
            "CharacterizationTests"));

    private static async Task<bool> OwnerPolicySucceedsAsync(
        KoochDbContext dbContext,
        int userId,
        UserRole role)
    {
        var requirement = new OwnerPanelAccessRequirement();
        var authorizationContext = new AuthorizationHandlerContext(
            [requirement],
            CreatePrincipal(userId, role),
            resource: null);
        var handler = new OwnerPanelAccessAuthorizationHandler(new PropertyAccessService(dbContext));

        await handler.HandleAsync(authorizationContext);

        return authorizationContext.HasSucceeded;
    }

    private static async Task<IReadOnlyList<PropertyResponse>> GetMineAsync(
        OwnerPropertiesController controller)
    {
        var response = await controller.GetMine(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        return Assert.IsAssignableFrom<IReadOnlyList<PropertyResponse>>(ok.Value);
    }

    private static async Task<PropertyResponse> GetByIdAsync(
        OwnerPropertiesController controller,
        int propertyId)
    {
        var response = await controller.GetById(propertyId, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        return Assert.IsType<PropertyResponse>(ok.Value);
    }

    private const string DashboardViewPermissionJson =
        """
        {
          "Dashboard": {
            "View": true,
            "Create": false,
            "Edit": false,
            "Delete": false,
            "Export": false
          }
        }
        """;
}
