using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyUserManagementBoundaryTests
{
    [Fact]
    public async Task AdminUsers_ReturnsOnlyPlatformAdministrativeAccounts()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "super-admin"),
            CreateUser(2, UserRole.AdminAssistant, "admin-assistant"),
            CreateUser(3, UserRole.Owner, "legacy-owner"),
            CreateUser(4, UserRole.OwnerAssistant, "legacy-assistant"),
            CreateUser(5, UserRole.Client, "client"));
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        var users = await service.GetUsersAsync(1, UserRole.SuperAdmin);

        Assert.Equal([1, 2], users.Select(user => user.Id).Order().ToArray());
    }

    [Fact]
    public async Task AdminUserCreate_DoesNotCreatePropertyMembership()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(1, UserRole.SuperAdmin, "super-admin"));
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        var created = await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            new AdminUserRequest
            {
                FirstName = "Platform",
                LastName = "Assistant",
                Email = "platform-assistant@example.test",
                Password = "password1",
                Role = UserRole.AdminAssistant
            });

        Assert.Equal(UserRole.AdminAssistant, created.Role);
        Assert.False(await dbContext.UserPropertyAccesses.AnyAsync(access => access.UserId == created.Id));
    }

    [Fact]
    public async Task AdminUserUpdate_PreservesExistingPropertyMembership()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "super-admin"),
            CreateUser(2, UserRole.AdminAssistant, "admin-assistant"));
        var membership = new UserPropertyAccess
        {
            UserId = 2,
            PropertyId = 100,
            PropertyRole = PropertyUserRole.Reception,
            Status = PropertyUserStatus.Suspended,
            IsActive = false,
            PermissionMatrixJson = "{\"Bookings\":{\"View\":true}}"
        };
        dbContext.UserPropertyAccesses.Add(membership);
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        await service.UpdateUserAsync(
            1,
            UserRole.SuperAdmin,
            2,
            new AdminUserRequest
            {
                FirstName = "Updated",
                LastName = "Assistant",
                Email = "updated-assistant@example.test",
                Role = UserRole.AdminAssistant
            });

        var preserved = await dbContext.UserPropertyAccesses.SingleAsync();
        Assert.Equal(PropertyUserRole.Reception, preserved.PropertyRole);
        Assert.Equal(PropertyUserStatus.Suspended, preserved.Status);
        Assert.False(preserved.IsActive);
        Assert.Equal("{\"Bookings\":{\"View\":true}}", preserved.PermissionMatrixJson);
    }

    [Fact]
    public async Task AdminUsers_RejectsPropertyAccountRoles()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(1, UserRole.SuperAdmin, "super-admin"));
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            new AdminUserRequest
            {
                FirstName = "Legacy",
                LastName = "Owner",
                Email = "legacy-owner@example.test",
                Password = "password1",
                Role = UserRole.Owner
            }));
    }

    [Fact]
    public async Task PropertyUserCreate_PersistsSelectedRoleStatusAndPermissionMatrix()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "super-admin"),
            CreateUser(2, UserRole.Client, "property-owner"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 10,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = 100,
            OwnerId = 2,
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
        await dbContext.SaveChangesAsync();
        var authorization = new PropertyAccessService(dbContext);
        var service = new PropertyUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            authorization,
            new StubAuthService(),
            new TestHostEnvironment());
        var permissions = new PermissionMatrixDto
        {
            ["Dashboard"] = new PermissionActionsDto { View = true },
            ["Bookings"] = new PermissionActionsDto { View = true, Edit = true }
        };

        var created = await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new PropertyUserRequest
            {
                FullName = "Property Reception",
                Email = "property-reception@example.test",
                Role = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Suspended,
                IsActive = false,
                Permissions = permissions
            });

        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.UserId == created.UserId);
        var user = await dbContext.Users.SingleAsync(item => item.Id == created.UserId);
        var storedPermissions = JsonSerializer.Deserialize<PermissionMatrixDto>(membership.PermissionMatrixJson);
        Assert.Equal(UserRole.Client, user.Role);
        Assert.Equal(PropertyUserRole.Reception, membership.PropertyRole);
        Assert.Equal(PropertyUserStatus.Suspended, membership.Status);
        Assert.False(membership.IsActive);
        Assert.True(storedPermissions!["Dashboard"].View);
        Assert.True(storedPermissions["Bookings"].Edit);
    }

    [Fact]
    public async Task PropertyUserOwnerPanelAccess_ComesFromActiveMembership()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "super-admin"),
            CreateUser(2, UserRole.Client, "property-owner"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 10,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = 100,
            OwnerId = 2,
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
        await dbContext.SaveChangesAsync();
        var authorization = new PropertyAccessService(dbContext);
        var service = new PropertyUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            authorization,
            new StubAuthService(),
            new TestHostEnvironment());

        var created = await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new PropertyUserRequest
            {
                FullName = "Property Manager",
                Email = "property-manager@example.test",
                Role = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                Permissions = new PermissionMatrixDto
                {
                    ["Dashboard"] = new PermissionActionsDto { View = true }
                }
            });

        var user = await dbContext.Users.SingleAsync(item => item.Id == created.UserId);
        Assert.Equal(UserRole.Client, user.Role);
        Assert.False(await authorization.CanAccessOwnerPanelAsync(created.UserId));

        user.IsActive = true;
        await dbContext.SaveChangesAsync();

        Assert.True(await authorization.CanAccessOwnerPanelAsync(created.UserId));
    }

    private static AdminUserService CreateAdminUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new AdminUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
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

    private sealed class StubAuthService : IAuthService
    {
        public Task<string> CreatePasswordSetupTokenAsync(int userId, CancellationToken cancellationToken = default) =>
            Task.FromResult("setup-token");

        public Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public string GenerateJwtToken(User user, DateTime expiresAtUtc) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RequestOtpAsync(RequestOtpRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task SetPasswordAsync(SetPasswordRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> VerifyOtpAsync(VerifyOtpRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
