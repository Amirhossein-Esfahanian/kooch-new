using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyAuthorizationServiceTests
{
    private const int FirstPropertyId = 101;
    private const int OtherPropertyId = 202;
    private const int LegacyOnlyPropertyId = 303;

    [Fact]
    public async Task Owner_ResolvesOnlyThroughCanonicalPropertyOwnerMembership()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        var effective = await service.GetEffectivePropertyPermissionsAsync(2, FirstPropertyId);

        Assert.NotNull(effective);
        Assert.Equal(PropertyUserRole.PropertyOwner, effective.PropertyRole);
        Assert.True(await service.HasPropertyPermissionAsync(2, FirstPropertyId, "property.edit"));
        Assert.False(await service.CanAccessPropertyAsync(2, OtherPropertyId));
        Assert.False(await service.CanAccessPropertyAsync(9, LegacyOnlyPropertyId));
    }

    [Fact]
    public async Task Manager_UsesPermissionMatrixAndNotLegacyBooleanColumns()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.True(await service.CanAccessPropertyAsync(3, FirstPropertyId));
        Assert.True(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "rooms.edit"));
        Assert.False(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "bookings.edit"));
        Assert.False(await service.CanAccessPropertyAsync(3, OtherPropertyId));
    }

    [Fact]
    public async Task MatrixPermissions_DriveLegacyCanManageWrapperMethods()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.True(await service.CanManageRoomsAsync(3, UserRole.Client, FirstPropertyId));
        Assert.False(await service.CanManagePricingAsync(3, UserRole.Client, FirstPropertyId));
        Assert.False(await service.CanManageAvailabilityAsync(3, UserRole.Client, FirstPropertyId));

        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.Id == 102);
        membership.PermissionMatrixJson = PropertyMatrix(
            ("Pricing", new PermissionActionsDto { Edit = true }),
            ("Inventory", new PermissionActionsDto { View = true }));
        await dbContext.SaveChangesAsync();

        Assert.False(await service.CanManageRoomsAsync(3, UserRole.Client, FirstPropertyId));
        Assert.True(await service.CanManagePricingAsync(3, UserRole.Client, FirstPropertyId));
        Assert.False(await service.CanManageAvailabilityAsync(3, UserRole.Client, FirstPropertyId));
    }

    [Fact]
    public async Task PropertyAssistant_LegacyGlobalRoleDoesNotExtendMembershipAccess()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.True(await service.HasPropertyPermissionAsync(4, FirstPropertyId, "bookings.view"));
        Assert.False(await service.CanAccessPropertyAsync(4, OtherPropertyId));
    }

    [Fact]
    public async Task SuspendedMembership_IsDenied()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.False(await service.CanAccessPropertyAsync(5, FirstPropertyId));
        Assert.False(await service.HasPropertyPermissionAsync(5, FirstPropertyId, "rooms.edit"));
    }

    [Fact]
    public async Task MembershipStatusChange_ImmediatelyAffectsPropertyAccess()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.Id == 102);

        Assert.True(await service.CanAccessPropertyAsync(3, FirstPropertyId));

        membership.Status = PropertyUserStatus.Suspended;
        membership.IsActive = false;
        await dbContext.SaveChangesAsync();

        Assert.False(await service.CanAccessPropertyAsync(3, FirstPropertyId));
        Assert.False(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "rooms.edit"));

        membership.Status = PropertyUserStatus.Active;
        membership.IsActive = true;
        await dbContext.SaveChangesAsync();

        Assert.True(await service.CanAccessPropertyAsync(3, FirstPropertyId));
        Assert.True(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "rooms.edit"));
    }

    [Fact]
    public async Task PermissionMatrixChange_ImmediatelyAffectsNextPermissionCheck()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.Id == 102);

        Assert.True(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "rooms.edit"));
        Assert.False(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "bookings.view"));

        membership.PermissionMatrixJson = PropertyMatrix(
            ("Bookings", new PermissionActionsDto { View = true }));
        await dbContext.SaveChangesAsync();

        Assert.False(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "rooms.edit"));
        Assert.True(await service.HasPropertyPermissionAsync(3, FirstPropertyId, "bookings.view"));
    }

    [Fact]
    public async Task InactiveAccount_IsDeniedDespiteActiveMembership()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.False(await service.CanAccessPropertyAsync(6, FirstPropertyId));
        Assert.Empty(await service.GetAccessiblePropertiesAsync(6));
    }

    [Fact]
    public async Task SuperAdmin_UsesExplicitPlatformBypass()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        var effective = await service.GetEffectivePropertyPermissionsAsync(1, OtherPropertyId);

        Assert.NotNull(effective);
        Assert.True(effective.IsSuperAdminBypass);
        Assert.True(await service.HasPropertyPermissionAsync(1, OtherPropertyId, "settings.delete"));
        Assert.Equal(
            [FirstPropertyId, OtherPropertyId, LegacyOnlyPropertyId],
            await service.GetAccessiblePropertiesAsync(1));
    }

    [Fact]
    public async Task AdminAssistant_RequiresPlatformPermissionAndExplicitMembership()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);

        Assert.True(await service.HasPropertyPermissionAsync(7, FirstPropertyId, "property.edit"));
        Assert.False(await service.HasPropertyPermissionAsync(7, FirstPropertyId, "rooms.edit"));
        Assert.False(await service.CanAccessPropertyAsync(7, OtherPropertyId));
    }

    [Fact]
    public async Task AdminAssistantWithoutMembership_IsDeniedEvenWithGlobalPlatformPermission()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PropertyAccessService(dbContext);
        var permissionService = new PermissionService(dbContext, service);

        Assert.False(await service.CanAccessOwnerPanelAsync(8));
        Assert.False(await service.CanAccessPropertyAsync(8, FirstPropertyId));
        Assert.False(await permissionService.HasPermissionAsync(
            8,
            PermissionKey.ManageProperties,
            FirstPropertyId));
    }

    [Fact]
    public async Task GlobalPlatformPermission_ContinuesToAuthorizeAdminAssistant()
    {
        await using var dbContext = await CreateContextAsync();
        var service = new PermissionService(dbContext, new PropertyAccessService(dbContext));

        Assert.True(await service.HasPermissionAsync(8, PermissionKey.ManageProperties));
        Assert.False(await service.HasPermissionAsync(3, PermissionKey.ManageProperties));
    }

    [Fact]
    public async Task DisabledGlobalPlatformPermission_RemainsDenied()
    {
        await using var dbContext = await CreateContextAsync();
        var permission = await dbContext.UserPermissions.SingleAsync(item => item.UserId == 8);
        permission.IsAllowed = false;
        await dbContext.SaveChangesAsync();
        var service = new PermissionService(dbContext, new PropertyAccessService(dbContext));

        Assert.False(await service.HasPermissionAsync(8, PermissionKey.ManageProperties));
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var dbContext = new KoochDbContext(options);

        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, true, "super-admin"),
            CreateUser(2, UserRole.Client, true, "owner"),
            CreateUser(3, UserRole.Client, true, "manager"),
            CreateUser(4, UserRole.OwnerAssistant, true, "property-assistant"),
            CreateUser(5, UserRole.Client, true, "suspended"),
            CreateUser(6, UserRole.Client, false, "inactive"),
            CreateUser(7, UserRole.AdminAssistant, true, "assigned-admin-assistant"),
            CreateUser(8, UserRole.AdminAssistant, true, "unassigned-admin-assistant"),
            CreateUser(9, UserRole.Owner, true, "legacy-owner"),
            CreateUser(10, UserRole.Client, true, "other-owner"));

        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(FirstPropertyId, 2, "First property"),
            CreateProperty(OtherPropertyId, 10, "Other property"),
            CreateProperty(LegacyOnlyPropertyId, 9, "Legacy owner property"));

        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(100, 2, FirstPropertyId, PropertyUserRole.PropertyOwner, PropertyMatrix(
                ("Properties", new PermissionActionsDto { View = true, Edit = true }))),
            CreateMembership(101, 10, OtherPropertyId, PropertyUserRole.PropertyOwner, PropertyMatrix(
                ("Properties", new PermissionActionsDto { View = true, Edit = true }))),
            CreateMembership(102, 3, FirstPropertyId, PropertyUserRole.Manager, PropertyMatrix(
                ("Rooms", new PermissionActionsDto { View = true, Edit = true }))),
            CreateMembership(103, 4, FirstPropertyId, PropertyUserRole.Reception, PropertyMatrix(
                ("Bookings", new PermissionActionsDto { View = true }))),
            CreateMembership(104, 5, FirstPropertyId, PropertyUserRole.Manager, PropertyMatrix(
                ("Rooms", new PermissionActionsDto { View = true, Edit = true })), PropertyUserStatus.Suspended, false),
            CreateMembership(105, 6, FirstPropertyId, PropertyUserRole.Manager, PropertyMatrix(
                ("Rooms", new PermissionActionsDto { View = true, Edit = true }))),
            CreateMembership(106, 7, FirstPropertyId, PropertyUserRole.Manager, PropertyMatrix(
                ("Properties", new PermissionActionsDto { View = true, Edit = true }),
                ("Rooms", new PermissionActionsDto { View = true, Edit = true }))));

        dbContext.Permissions.Add(new Permission
        {
            Id = 200,
            Key = PermissionKey.ManageProperties,
            Name = nameof(PermissionKey.ManageProperties)
        });
        dbContext.UserPermissions.AddRange(
            CreateUserPermission(300, 7),
            CreateUserPermission(301, 8));

        await dbContext.SaveChangesAsync();
        return dbContext;
    }

    private static User CreateUser(int id, UserRole role, bool isActive, string identifier) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
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
        PropertyUserRole role,
        string matrix,
        PropertyUserStatus status = PropertyUserStatus.Active,
        bool isActive = true) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = role,
        Status = status,
        IsActive = isActive,
        PermissionMatrixJson = matrix
    };

    private static UserPermission CreateUserPermission(int id, int userId) => new()
    {
        Id = id,
        UserId = userId,
        PermissionKey = PermissionKey.ManageProperties,
        IsAllowed = true
    };

    private static string PropertyMatrix(
        params (string Group, PermissionActionsDto Actions)[] permissions)
    {
        var matrix = new PermissionMatrixDto();
        foreach (var (group, actions) in permissions)
        {
            matrix[group] = actions;
        }

        return JsonSerializer.Serialize(matrix);
    }
}
