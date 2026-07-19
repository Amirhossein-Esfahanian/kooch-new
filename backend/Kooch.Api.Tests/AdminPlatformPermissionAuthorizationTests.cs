using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminPlatformPermissionAuthorizationTests
{
    public static IEnumerable<object[]> AdminSurfaces =>
    [
        [typeof(AdminDashboardController), PermissionKey.ViewDashboard],
        [typeof(AdminGuestsController), PermissionKey.ManageGuests],
        [typeof(AdminPromotionsController), PermissionKey.ManagePromotions]
    ];

    public static IEnumerable<object[]> PermissionRoleCases =>
    [
        [PermissionKey.ViewDashboard, SuperAdminId, true],
        [PermissionKey.ViewDashboard, AdminAssistantWithPermissionId, true],
        [PermissionKey.ViewDashboard, AdminAssistantWithoutPermissionId, false],
        [PermissionKey.ViewDashboard, ClientId, false],
        [PermissionKey.ManageGuests, SuperAdminId, true],
        [PermissionKey.ManageGuests, AdminAssistantWithPermissionId, true],
        [PermissionKey.ManageGuests, AdminAssistantWithoutPermissionId, false],
        [PermissionKey.ManageGuests, ClientId, false],
        [PermissionKey.ManagePromotions, SuperAdminId, true],
        [PermissionKey.ManagePromotions, AdminAssistantWithPermissionId, true],
        [PermissionKey.ManagePromotions, AdminAssistantWithoutPermissionId, false],
        [PermissionKey.ManagePromotions, ClientId, false]
    ];

    [Theory]
    [MemberData(nameof(AdminSurfaces))]
    public void AdminSurface_RequiresCanonicalPermissionAtControllerBoundary(
        Type controllerType,
        PermissionKey permissionKey)
    {
        Assert.NotNull(controllerType.GetCustomAttributes(typeof(AdminAuthorizeAttribute), inherit: true).SingleOrDefault());

        var permissionAttribute = Assert.Single(
            controllerType.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), inherit: true)
                .OfType<PermissionAuthorizeAttribute>());
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{permissionKey}", permissionAttribute.Policy);
    }

    [Theory]
    [MemberData(nameof(PermissionRoleCases))]
    public async Task CanonicalPlatformPermission_DecidesAdminSurfaceAccess(
        PermissionKey permissionKey,
        int userId,
        bool expected)
    {
        await using var dbContext = CreateContext();
        await SeedUsersAsync(dbContext, permissionKey);
        var service = new PermissionService(dbContext, new PropertyAccessService(dbContext));

        Assert.Equal(expected, await service.HasPermissionAsync(userId, permissionKey));
    }

    [Theory]
    [InlineData(SuperAdminId, UserRole.SuperAdmin)]
    [InlineData(AdminAssistantWithPermissionId, UserRole.AdminAssistant)]
    public async Task PromotionService_GlobalMutation_AllowsOnlyCanonicalPromotionPermission(
        int userId,
        UserRole role)
    {
        await using var dbContext = CreateContext();
        await SeedUsersAsync(dbContext, PermissionKey.ManagePromotions);
        var service = CreatePromotionService(dbContext);

        var created = await service.CreateAsync(
            userId,
            role,
            null,
            PromotionRequest($"Allowed {userId}"));

        Assert.Equal($"Allowed {userId}", created.Title);
        Assert.Null(created.PropertyId);
        Assert.Equal(PromotionSource.Admin, created.Source);
    }

    [Theory]
    [InlineData(AdminAssistantWithoutPermissionId, UserRole.AdminAssistant)]
    [InlineData(ClientId, UserRole.Client)]
    public async Task PromotionService_GlobalMutation_DeniesWithoutCanonicalPromotionPermission(
        int userId,
        UserRole role)
    {
        await using var dbContext = CreateContext();
        await SeedUsersAsync(dbContext, PermissionKey.ManagePromotions);
        var service = CreatePromotionService(dbContext);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateAsync(
            userId,
            role,
            null,
            PromotionRequest($"Denied {userId}")));

        Assert.False(await dbContext.Promotions.AnyAsync(promotion => promotion.Title == $"Denied {userId}"));
    }

    private static PromotionService CreatePromotionService(KoochDbContext dbContext)
    {
        var accessService = new PropertyAccessService(dbContext);
        var permissionService = new PermissionService(dbContext, accessService);
        return new PromotionService(dbContext, accessService, permissionService);
    }

    private static async Task SeedUsersAsync(KoochDbContext dbContext, PermissionKey permissionKey)
    {
        dbContext.Users.AddRange(
            CreateUser(SuperAdminId, UserRole.SuperAdmin, "super-admin"),
            CreateUser(AdminAssistantWithPermissionId, UserRole.AdminAssistant, "admin-assistant-with-permission"),
            CreateUser(AdminAssistantWithoutPermissionId, UserRole.AdminAssistant, "admin-assistant-without-permission"),
            CreateUser(ClientId, UserRole.Client, "client"));
        dbContext.Permissions.Add(new Permission
        {
            Key = permissionKey,
            Name = permissionKey.ToString()
        });
        dbContext.UserPermissions.Add(new UserPermission
        {
            UserId = AdminAssistantWithPermissionId,
            PermissionKey = permissionKey,
            IsAllowed = true
        });
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

    private static PromotionUpsertRequest PromotionRequest(string title) => new()
    {
        Title = title,
        PublicDescription = "Public promotion description",
        Type = PromotionType.Informational,
        StartDate = new DateOnly(2026, 7, 18),
        EndDate = new DateOnly(2026, 7, 19),
        Weekdays = [DayOfWeek.Saturday],
        IsActive = true,
        IsPublished = true
    };

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private const int SuperAdminId = 1;
    private const int AdminAssistantWithPermissionId = 2;
    private const int AdminAssistantWithoutPermissionId = 3;
    private const int ClientId = 4;
}