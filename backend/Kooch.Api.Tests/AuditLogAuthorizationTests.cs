using System.Reflection;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AuditLogAuthorizationTests
{
    [Fact]
    public void AuditLogsEndpoint_RequiresOwnerPanelAndCanonicalReportsPermission()
    {
        Assert.NotNull(typeof(AuditLogsController)
            .GetCustomAttributes(typeof(OwnerAuthorizeAttribute), inherit: true)
            .SingleOrDefault());

        var permissionAttribute = Assert.Single(typeof(AuditLogsController)
            .GetCustomAttributes(typeof(PermissionAuthorizeAttribute), inherit: true)
            .OfType<PermissionAuthorizeAttribute>());
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ViewReports}", permissionAttribute.Policy);
    }

    [Theory]
    [InlineData(SuperAdminId, UserRole.SuperAdmin, FirstPropertyId, true)]
    [InlineData(AdminAssistantWithReportsId, UserRole.AdminAssistant, FirstPropertyId, true)]
    [InlineData(ClientWithReportsId, UserRole.Client, FirstPropertyId, true)]
    [InlineData(ClientWithPropertyViewOnlyId, UserRole.Client, FirstPropertyId, false)]
    [InlineData(SuspendedMemberId, UserRole.Client, FirstPropertyId, false)]
    [InlineData(ClientWithReportsId, UserRole.Client, OtherPropertyId, false)]
    [InlineData(ClientWithoutMembershipId, UserRole.Client, FirstPropertyId, false)]
    public async Task AuditLogService_RequiresCanonicalReportsPermission(
        int userId,
        UserRole role,
        int propertyId,
        bool expectedAllowed)
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var service = CreateService(dbContext);

        if (expectedAllowed)
        {
            var logs = await service.GetByPropertyAsync(userId, role, propertyId);
            Assert.Single(logs);
            Assert.Equal(propertyId, logs[0].PropertyId);
        }
        else
        {
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                service.GetByPropertyAsync(userId, role, propertyId));
        }
    }

    [Fact]
    public async Task AuditLogService_AdminAssistantWithMembershipButWithoutPlatformReportsPermission_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        dbContext.UserPermissions.RemoveRange(dbContext.UserPermissions.Where(permission =>
            permission.UserId == AdminAssistantWithReportsId &&
            permission.PermissionKey == PermissionKey.ViewReports));
        await dbContext.SaveChangesAsync();
        var service = CreateService(dbContext);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetByPropertyAsync(AdminAssistantWithReportsId, UserRole.AdminAssistant, FirstPropertyId));
    }

    private static AuditLogService CreateService(KoochDbContext dbContext)
    {
        var propertyAccessService = new PropertyAccessService(dbContext);
        return new AuditLogService(
            dbContext,
            new PermissionService(dbContext, propertyAccessService));
    }

    private static async Task SeedAsync(KoochDbContext dbContext)
    {
        dbContext.Users.AddRange(
            CreateUser(SuperAdminId, UserRole.SuperAdmin, "super-admin"),
            CreateUser(AdminAssistantWithReportsId, UserRole.AdminAssistant, "admin-assistant-reports"),
            CreateUser(ClientWithReportsId, UserRole.Client, "client-reports"),
            CreateUser(ClientWithPropertyViewOnlyId, UserRole.Client, "client-property-view"),
            CreateUser(SuspendedMemberId, UserRole.Client, "client-suspended"),
            CreateUser(ClientWithoutMembershipId, UserRole.Client, "client-no-membership"),
            CreateUser(OwnerUserId, UserRole.Client, "owner"));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(FirstPropertyId, "First property"),
            CreateProperty(OtherPropertyId, "Other property"));
        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(AdminAssistantWithReportsId, FirstPropertyId, ReportsMatrix()),
            CreateMembership(ClientWithReportsId, FirstPropertyId, ReportsMatrix()),
            CreateMembership(ClientWithPropertyViewOnlyId, FirstPropertyId, PropertyViewMatrix()),
            CreateMembership(SuspendedMemberId, FirstPropertyId, ReportsMatrix(), PropertyUserStatus.Suspended, false),
            CreateMembership(ClientWithReportsId, OtherPropertyId, ReportsMatrix(), PropertyUserStatus.Active, true, isDeleted: true));
        dbContext.UserPermissions.Add(new UserPermission
        {
            UserId = AdminAssistantWithReportsId,
            PermissionKey = PermissionKey.ViewReports,
            IsAllowed = true
        });
        dbContext.AuditLogs.AddRange(
            CreateAuditLog(FirstPropertyId, "First audit log"),
            CreateAuditLog(OtherPropertyId, "Other audit log"));
        await dbContext.SaveChangesAsync();
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

    private static Property CreateProperty(int id, string name) => new()
    {
        Id = id,
        OwnerId = OwnerUserId,
        DestinationId = DestinationId,
        Name = name,
        Slug = name.ToLowerInvariant().Replace(' ', '-'),
        Description = name,
        Address = "Address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private static UserPropertyAccess CreateMembership(
        int userId,
        int propertyId,
        string permissionMatrixJson,
        PropertyUserStatus status = PropertyUserStatus.Active,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = PropertyUserRole.Manager,
        Status = status,
        IsActive = isActive,
        IsDeleted = isDeleted,
        PermissionMatrixJson = permissionMatrixJson
    };

    private static AuditLog CreateAuditLog(int propertyId, string description) => new()
    {
        UserId = OwnerUserId,
        PropertyId = propertyId,
        Action = AuditAction.PriceChanged,
        EntityType = nameof(Property),
        EntityId = propertyId,
        EntityName = description,
        Description = description,
        OccurredAtUtc = DateTime.UtcNow
    };

    private static string ReportsMatrix() => SerializeMatrix(
        "Reports",
        new PermissionActionsDto { View = true });

    private static string PropertyViewMatrix() => SerializeMatrix(
        "Properties",
        new PermissionActionsDto { View = true });

    private static string SerializeMatrix(string group, PermissionActionsDto actions)
    {
        var matrix = new PermissionMatrixDto
        {
            [group] = actions
        };
        return JsonSerializer.Serialize(matrix);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private const int SuperAdminId = 1;
    private const int AdminAssistantWithReportsId = 2;
    private const int ClientWithReportsId = 3;
    private const int ClientWithPropertyViewOnlyId = 4;
    private const int SuspendedMemberId = 5;
    private const int ClientWithoutMembershipId = 6;
    private const int OwnerUserId = 7;
    private const int DestinationId = 10;
    private const int FirstPropertyId = 100;
    private const int OtherPropertyId = 101;
}