using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public class PropertyPermissionMetadataTests
{
    [Fact]
    public async Task Metadata_UsesCanonicalPropertyDefinitionsAndActorPermissions()
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateService(dbContext);

        var metadata = await service.GetPermissionMetadataAsync(ManagerUserId, PropertyId);

        Assert.Equal(11, metadata.Groups.Count);
        Assert.Equal(["view", "create", "edit", "delete", "export"],
            metadata.Actions.Select(action => action.Key));
        Assert.Contains(metadata.Groups, group =>
            group.Key == "Users" &&
            group.Label == "کاربران اقامتگاه" &&
            group.SupportedActions.SequenceEqual(metadata.Actions.Select(action => action.Key)));
        Assert.DoesNotContain(metadata.Groups, group =>
            group.Key.Contains("Admin", StringComparison.OrdinalIgnoreCase) ||
            group.Key.Contains("Global", StringComparison.OrdinalIgnoreCase));

        Assert.True(metadata.ActorAssignablePermissions["Users"].View);
        Assert.True(metadata.ActorAssignablePermissions["Users"].Create);
        Assert.False(metadata.ActorAssignablePermissions["Users"].Delete);
        Assert.True(metadata.ActorAssignablePermissions["Rooms"].Edit);
        Assert.False(metadata.ActorAssignablePermissions["Financial"].View);

        var managerDefaults = metadata.RoleDefaults[PropertyUserRole.Manager];
        Assert.True(managerDefaults["Bookings"].Export);
        Assert.True(managerDefaults["Rooms"].Delete);
        Assert.False(managerDefaults["Users"].Delete);
        Assert.All(metadata.RoleDefaults.Values, matrix =>
            Assert.Equal(metadata.Groups.Select(group => group.Key), matrix.Keys));
    }

    [Fact]
    public async Task Metadata_IsDeniedOutsideActorsCurrentProperty()
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateService(dbContext);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetPermissionMetadataAsync(ManagerUserId, OtherPropertyId));
    }

    [Fact]
    public async Task Metadata_GivesSuperAdminCanonicalOwnerAssignableMatrix()
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateService(dbContext);

        var metadata = await service.GetPermissionMetadataAsync(SuperAdminUserId, PropertyId);

        Assert.All(metadata.ActorAssignablePermissions.Values, actions =>
        {
            Assert.True(actions.View);
            Assert.True(actions.Create);
            Assert.True(actions.Edit);
            Assert.True(actions.Delete);
            Assert.True(actions.Export);
        });
    }

    private static PropertyUserService CreateService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyUserService(
            dbContext,
            authorization,
            null!,
            null!);
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var dbContext = new KoochDbContext(options);
        dbContext.Users.AddRange(
            CreateUser(SuperAdminUserId, UserRole.SuperAdmin, "admin"),
            CreateUser(OwnerUserId, UserRole.Client, "owner"),
            CreateUser(OtherOwnerUserId, UserRole.Client, "other-owner"),
            CreateUser(ManagerUserId, UserRole.Client, "manager"));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(PropertyId, OwnerUserId, "First property"),
            CreateProperty(OtherPropertyId, OtherOwnerUserId, "Other property"));
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = ManagerUserId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.Manager,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
            {
                ["Users"] = new PermissionActionsDto { View = true, Create = true, Edit = true },
                ["Rooms"] = new PermissionActionsDto { View = true, Edit = true }
            })
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
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private static Property CreateProperty(int id, int ownerId, string name) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = DestinationId,
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

    private const int SuperAdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int OtherOwnerUserId = 3;
    private const int ManagerUserId = 4;
    private const int DestinationId = 10;
    private const int PropertyId = 100;
    private const int OtherPropertyId = 200;
}
