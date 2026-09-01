using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AuthC5AuthorizationConsistencyTests
{
    [Fact]
    public async Task AdminDashboard_TotalOwnersCountsDistinctActivePropertyOwnerMembershipsOnly()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin),
            CreateUser(2, UserRole.Owner),
            CreateUser(3, UserRole.Client),
            CreateUser(4, UserRole.Client),
            CreateUser(5, UserRole.Client));
        dbContext.Destinations.Add(new Destination { Id = 1, Name = "Kashan", Slug = "kashan", Country = "Iran" });
        dbContext.Properties.AddRange(
            CreateProperty(1, 3, "First property"),
            CreateProperty(2, 3, "Second property"),
            CreateProperty(3, 4, "Third property"));
        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(1, 3, 1, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true),
            CreateMembership(2, 3, 2, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true),
            CreateMembership(3, 4, 3, PropertyUserRole.PropertyOwner, PropertyUserStatus.Suspended, true),
            CreateMembership(4, 5, 3, PropertyUserRole.Manager, PropertyUserStatus.Active, true));
        await dbContext.SaveChangesAsync();

        var result = await new AdminDashboardController(dbContext).Get(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<AdminDashboardResponse>(ok.Value);
        Assert.Equal(1, response.TotalOwners);
    }

    [Fact]
    public async Task GlobalAmenityMutationRequiresManageAmenitiesPlatformPermission()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.AdminAssistant),
            CreateUser(2, UserRole.Client));
        dbContext.AmenityCategories.Add(new AmenityCategory
        {
            Id = 10,
            Name = "General",
            Slug = "general",
            IsActive = true
        });
        await dbContext.SaveChangesAsync();

        var controller = CreateAmenitiesController(dbContext, 1, UserRole.AdminAssistant);
        var request = new AmenityRequest
        {
            AmenityCategoryId = 10,
            Name = "Pool",
            Slug = "pool",
            Scope = AmenityScope.Property
        };

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Create(request, CancellationToken.None));

        dbContext.UserPermissions.Add(new UserPermission
        {
            UserId = 1,
            PermissionKey = PermissionKey.ManageAmenities,
            IsAllowed = true
        });
        await dbContext.SaveChangesAsync();

        var result = await controller.Create(request, CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        Assert.Equal(1, await dbContext.Amenities.CountAsync());
    }

    [Fact]
    public void GlobalAmenityMutationEndpointsAreAdminOnly()
    {
        AssertAdminOnlyMutation<AmenitiesController>(nameof(AmenitiesController.Create));
        AssertAdminOnlyMutation<AmenitiesController>(nameof(AmenitiesController.Update));
        AssertAdminOnlyMutation<AmenitiesController>(nameof(AmenitiesController.Delete));
        AssertAdminOnlyMutation<AmenitiesController>(nameof(AmenitiesController.StageSvg));
        AssertAdminOnlyMutation<AmenityCategoriesController>(nameof(AmenityCategoriesController.Create));
        AssertAdminOnlyMutation<AmenityCategoriesController>(nameof(AmenityCategoriesController.Update));
        AssertAdminOnlyMutation<AmenityCategoriesController>(nameof(AmenityCategoriesController.Delete));
        AssertAdminOnlyMutation<AmenityCategoriesController>(nameof(AmenityCategoriesController.StageSvg));
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static AmenitiesController CreateAmenitiesController(
        KoochDbContext dbContext,
        int userId,
        UserRole role)
    {
        var permissionService = new PermissionService(dbContext, new PropertyAccessService(dbContext));
        return new AmenitiesController(
            dbContext,
            permissionService,
            null!,
            null!,
            NullLogger<AmenitiesController>.Instance)
        {
            ControllerContext = CreateControllerContext(userId, role)
        };
    }

    private static ControllerContext CreateControllerContext(int userId, UserRole role) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim(ClaimTypes.Role, role.ToString())
                ],
                "Test"))
        }
    };

    private static void AssertAdminOnlyMutation<TController>(string methodName)
    {
        var method = typeof(TController).GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .Single(method => method.Name == methodName);

        Assert.Contains(method.GetCustomAttributes(), attribute => attribute is AdminAuthorizeAttribute);
        Assert.DoesNotContain(method.GetCustomAttributes(), attribute => attribute is OwnerAuthorizeAttribute);
    }

    private static User CreateUser(int id, UserRole role) => new()
    {
        Id = id,
        FirstName = $"User{id}",
        LastName = "Test",
        Email = $"user{id}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
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
        PropertyUserStatus status,
        bool isActive) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = propertyRole,
        Status = status,
        IsActive = isActive,
        PermissionMatrixJson = "{}"
    };
}
