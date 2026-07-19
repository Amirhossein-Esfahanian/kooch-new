using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CurrentUserSessionContractTests
{
    private const int FirstPropertyId = 101;
    private const int SecondPropertyId = 202;

    [Fact]
    public async Task SuperAdmin_HasAdminWorkspaceAndOnlyExplicitMembershipsInSession()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(1);

        Assert.NotNull(response);
        Assert.Equal(UserRole.SuperAdmin, response.PlatformRole);
        Assert.Equal([WorkspaceNames.Admin, WorkspaceNames.Owner], response.Workspaces);
        Assert.Equal(WorkspaceNames.Admin, response.DefaultWorkspace);
        Assert.Equal(SecondPropertyId, response.DefaultPropertyId);
        var membership = Assert.Single(response.PropertyMemberships);
        Assert.Equal(SecondPropertyId, membership.PropertyId);
        Assert.Equal(PropertyUserRole.Manager, membership.PropertyRole);
        Assert.True(membership.EffectivePermissions["Properties"].Edit);
    }

    [Fact]
    public async Task AdminAssistantWithoutMembership_HasOnlyAdminWorkspace()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(2);

        Assert.NotNull(response);
        Assert.Equal(UserRole.AdminAssistant, response.PlatformRole);
        Assert.Equal([WorkspaceNames.Admin], response.Workspaces);
        Assert.Empty(response.PropertyMemberships);
        Assert.Equal(WorkspaceNames.Admin, response.DefaultWorkspace);
        Assert.Null(response.DefaultPropertyId);
    }

    [Fact]
    public async Task PropertyOwner_UsesCanonicalMembershipAndDefaultsToOwnerWorkspace()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(3);

        Assert.NotNull(response);
        Assert.Equal(UserRole.Client, response.PlatformRole);
        Assert.Equal([WorkspaceNames.Owner, WorkspaceNames.Account], response.Workspaces);
        Assert.Equal(WorkspaceNames.Owner, response.DefaultWorkspace);
        Assert.Equal(FirstPropertyId, response.DefaultPropertyId);
        var membership = Assert.Single(response.PropertyMemberships);
        Assert.Equal(PropertyUserRole.PropertyOwner, membership.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, membership.MembershipStatus);
        Assert.True(membership.IsActive);
        Assert.True(membership.EffectivePermissions["Properties"].Edit);
    }

    [Fact]
    public async Task PropertyAssistant_LegacyRoleDoesNotCreateExtraWorkspaceAccess()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(4);

        Assert.NotNull(response);
        Assert.Equal(UserRole.Client, response.PlatformRole);
        Assert.Equal([WorkspaceNames.Owner, WorkspaceNames.Account], response.Workspaces);
        Assert.Equal(WorkspaceNames.Owner, response.DefaultWorkspace);
        Assert.Single(response.PropertyMemberships);
    }

    [Fact]
    public async Task SessionRefresh_ReflectsCurrentMembershipPermissionsAndStatus()
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateService(dbContext);
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.Id == 103);

        var initial = await service.GetCurrentUserAsync(4);
        Assert.NotNull(initial);
        Assert.Contains(WorkspaceNames.Owner, initial.Workspaces);
        Assert.True(initial.PropertyMemberships.Single().EffectivePermissions["Dashboard"].View);

        membership.PermissionMatrixJson = SerializeMatrix(
            "Rooms",
            new PermissionActionsDto { View = true, Edit = true });
        await dbContext.SaveChangesAsync();

        var afterPermissionChange = await service.GetCurrentUserAsync(4);
        Assert.NotNull(afterPermissionChange);
        var refreshedMembership = afterPermissionChange.PropertyMemberships.Single();
        Assert.False(refreshedMembership.EffectivePermissions.TryGetValue("Dashboard", out var dashboard) && dashboard.View);
        Assert.True(refreshedMembership.EffectivePermissions["Rooms"].Edit);

        membership.Status = PropertyUserStatus.Suspended;
        membership.IsActive = false;
        await dbContext.SaveChangesAsync();

        var afterSuspension = await service.GetCurrentUserAsync(4);
        Assert.NotNull(afterSuspension);
        Assert.Equal([WorkspaceNames.Account], afterSuspension.Workspaces);
        Assert.Null(afterSuspension.DefaultPropertyId);
        Assert.False(afterSuspension.PropertyMemberships.Single().EffectivePermissions["Rooms"].Edit);
    }

    [Fact]
    public async Task NormalClientWithZeroMemberships_HasOnlyAccountWorkspace()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(5);

        Assert.NotNull(response);
        Assert.Equal("normal", response.FirstName);
        Assert.Equal("client", response.LastName);
        Assert.Equal("normal-client@example.test", response.Email);
        Assert.Equal("09120000005", response.PhoneNumber);
        Assert.True(response.IsActive);
        Assert.Equal([WorkspaceNames.Account], response.Workspaces);
        Assert.Empty(response.PropertyMemberships);
        Assert.Equal(WorkspaceNames.Account, response.DefaultWorkspace);
        Assert.Null(response.DefaultPropertyId);
    }

    [Fact]
    public async Task InactiveUser_IsNotReturned()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(6);

        Assert.Null(response);
    }

    [Fact]
    public async Task MultipleActiveMemberships_AreReturnedWithDeterministicDefaultProperty()
    {
        await using var dbContext = await CreateContextAsync();

        var response = await CreateService(dbContext).GetCurrentUserAsync(7);

        Assert.NotNull(response);
        Assert.Equal([WorkspaceNames.Owner, WorkspaceNames.Account], response.Workspaces);
        Assert.Equal(2, response.PropertyMemberships.Count);
        Assert.Equal(
            [FirstPropertyId, SecondPropertyId],
            response.PropertyMemberships.Select(item => item.PropertyId).Order().ToArray());
        Assert.Equal(FirstPropertyId, response.DefaultPropertyId);
    }

    [Fact]
    public async Task Me_UsesDatabaseRoleInsteadOfStaleJwtRoleClaim()
    {
        await using var dbContext = await CreateContextAsync();
        var controller = new AuthController(CreateService(dbContext))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [
                            new Claim(ClaimTypes.NameIdentifier, "5"),
                            new Claim(ClaimTypes.Role, UserRole.SuperAdmin.ToString())
                        ],
                        "Test"))
                }
            }
        };

        var result = await controller.Me(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<CurrentUserResponse>(ok.Value);
        Assert.Equal(UserRole.Client, response.PlatformRole);
        Assert.Equal([WorkspaceNames.Account], response.Workspaces);
    }

    private static AuthService CreateService(KoochDbContext dbContext) => new(
        dbContext,
        Options.Create(new JwtOptions()),
        new PropertyAccessService(dbContext),
        null!,
        null!);

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var dbContext = new KoochDbContext(options);

        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, true, "super", "admin"),
            CreateUser(2, UserRole.AdminAssistant, true, "admin", "assistant"),
            CreateUser(3, UserRole.Client, true, "property", "owner"),
            CreateUser(4, UserRole.OwnerAssistant, true, "property", "assistant"),
            CreateUser(5, UserRole.Client, true, "normal", "client"),
            CreateUser(6, UserRole.Client, false, "inactive", "client"),
            CreateUser(7, UserRole.Client, true, "multi", "member"),
            CreateUser(8, UserRole.Client, true, "second", "owner"));

        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(FirstPropertyId, 3, "First property"),
            CreateProperty(SecondPropertyId, 8, "Second property"));

        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(100, 3, FirstPropertyId, PropertyUserRole.PropertyOwner, PropertiesEditMatrix),
            CreateMembership(101, 8, SecondPropertyId, PropertyUserRole.PropertyOwner, PropertiesEditMatrix),
            CreateMembership(102, 1, SecondPropertyId, PropertyUserRole.Manager, DashboardViewMatrix),
            CreateMembership(103, 4, FirstPropertyId, PropertyUserRole.Reception, DashboardViewMatrix),
            CreateMembership(104, 6, FirstPropertyId, PropertyUserRole.Manager, DashboardViewMatrix),
            CreateMembership(105, 7, FirstPropertyId, PropertyUserRole.Manager, DashboardViewMatrix),
            CreateMembership(106, 7, SecondPropertyId, PropertyUserRole.Manager, DashboardViewMatrix));

        await dbContext.SaveChangesAsync();
        return dbContext;
    }

    private static User CreateUser(
        int id,
        UserRole role,
        bool isActive,
        string firstName,
        string lastName) => new()
    {
        Id = id,
        FirstName = firstName,
        LastName = lastName,
        Email = $"{firstName}-{lastName}@example.test",
        PhoneNumber = $"091200000{id:00}",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive
    };

    private static Property CreateProperty(int id, int ownerId, string name) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = 1,
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

    private static UserPropertyAccess CreateMembership(
        int id,
        int userId,
        int propertyId,
        PropertyUserRole propertyRole,
        string permissionMatrixJson) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = propertyRole,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = permissionMatrixJson
    };

    private static string SerializeMatrix(string group, PermissionActionsDto actions) =>
        JsonSerializer.Serialize(new PermissionMatrixDto { [group] = actions });

    private static readonly string PropertiesEditMatrix = SerializeMatrix(
        "Properties",
        new PermissionActionsDto { View = true, Edit = true });

    private static readonly string DashboardViewMatrix = SerializeMatrix(
        "Dashboard",
        new PermissionActionsDto { View = true });
}
