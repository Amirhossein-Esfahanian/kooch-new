using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SessionRevocationTests
{
    [Fact]
    public async Task JwtToken_IncludesCurrentSessionVersion()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(TargetUserId, UserRole.Client, "client", isActive: true, sessionVersion: 7));
        await dbContext.SaveChangesAsync();
        var user = await dbContext.Users.SingleAsync(user => user.Id == TargetUserId);
        var service = CreateAuthService(dbContext);

        var token = service.GenerateJwtToken(user, DateTime.UtcNow.AddHours(1));
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("7", jwt.Claims.Single(claim => claim.Type == KoochJwtClaimTypes.SessionVersion).Value);
    }

    [Fact]
    public async Task SessionVersionValidator_RejectsOldVersionInactiveAndDeletedAccounts()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(TargetUserId, UserRole.Client, "client", isActive: true, sessionVersion: 3));
        await dbContext.SaveChangesAsync();

        Assert.True(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 3));
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 2));

        var user = await dbContext.Users.SingleAsync(user => user.Id == TargetUserId);
        user.IsActive = false;
        await dbContext.SaveChangesAsync();
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 3));

        user.IsActive = true;
        user.IsDeleted = true;
        await dbContext.SaveChangesAsync();
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 3));
    }

    [Fact]
    public async Task PasswordSetup_IncrementsSessionVersionAndConsumesPreviousTokens()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(TargetUserId, UserRole.Client, "client", isActive: false, sessionVersion: 4, passwordSetupRequired: true));
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = TargetUserId,
            TokenHash = HashToken(SetupToken),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        await dbContext.SaveChangesAsync();
        var service = CreateAuthService(dbContext);

        await service.SetPasswordAsync(new SetPasswordRequest
        {
            Token = SetupToken,
            NewPassword = "newpassword1",
            ConfirmPassword = "newpassword1"
        });

        var user = await dbContext.Users.SingleAsync(user => user.Id == TargetUserId);
        Assert.Equal(5, user.SecurityStampVersion);
        Assert.True(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 5));
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 4));
    }

    [Fact]
    public async Task AdminPasswordAndRoleChange_IncrementsSessionVersionOnce()
    {
        await using var dbContext = CreateContext();
        SeedAdminUsers(dbContext, targetSessionVersion: 10);
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        await service.UpdateUserAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            TargetUserId,
            new AdminUserRequest
            {
                FirstName = "Updated",
                LastName = "Admin",
                Email = "updated-admin@example.test",
                Password = "changedpassword1",
                Role = UserRole.SuperAdmin
            });

        var user = await dbContext.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TargetUserId);
        Assert.Equal(UserRole.SuperAdmin, user.Role);
        Assert.Equal(11, user.SecurityStampVersion);
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 10));
    }

    [Fact]
    public async Task AdminDeactivate_IncrementsSessionVersion()
    {
        await using var dbContext = CreateContext();
        SeedAdminUsers(dbContext, targetSessionVersion: 2);
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        await service.SetActiveAsync(AdminUserId, UserRole.SuperAdmin, TargetUserId, false);

        var user = await dbContext.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TargetUserId);
        Assert.False(user.IsActive);
        Assert.Equal(3, user.SecurityStampVersion);
        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, TargetUserId, 2));
    }

    [Fact]
    public async Task PropertyMembershipChanges_DoNotIncrementSessionVersion()
    {
        await using var dbContext = CreateContext();
        SeedPropertyUser(dbContext, targetSessionVersion: 6);
        await dbContext.SaveChangesAsync();
        var service = CreatePropertyUserService(dbContext);

        await service.SetStatusAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            PropertyId,
            TargetUserId,
            PropertyUserStatus.Suspended);

        var user = await dbContext.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TargetUserId);
        Assert.Equal(6, user.SecurityStampVersion);
    }

    private static AuthService CreateAuthService(KoochDbContext dbContext) => new(
        dbContext,
        Options.Create(new JwtOptions
        {
            Issuer = "kooch-tests",
            Audience = "kooch-tests",
            Key = "0123456789abcdef0123456789abcdef",
            ExpiresMinutes = 60,
            AccessTokenExpirationDays = 30
        }),
        new PropertyAccessService(dbContext),
        null!,
        null!);

    private static AdminUserService CreateAdminUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new AdminUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
    }

    private static PropertyUserService CreatePropertyUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            authorization,
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

    private static void SeedAdminUsers(KoochDbContext dbContext, int targetSessionVersion)
    {
        dbContext.Users.AddRange(
            CreateUser(AdminUserId, UserRole.SuperAdmin, "super-admin", isActive: true),
            CreateUser(TargetUserId, UserRole.AdminAssistant, "admin-assistant", isActive: true, sessionVersion: targetSessionVersion));
    }

    private static void SeedPropertyUser(KoochDbContext dbContext, int targetSessionVersion)
    {
        dbContext.Users.AddRange(
            CreateUser(AdminUserId, UserRole.SuperAdmin, "super-admin", isActive: true),
            CreateUser(OwnerUserId, UserRole.Client, "owner", isActive: true),
            CreateUser(TargetUserId, UserRole.Client, "staff", isActive: true, sessionVersion: targetSessionVersion));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = PropertyId,
            OwnerId = OwnerUserId,
            DestinationId = DestinationId,
            Name = "Test property",
            Slug = "test-property-session-revocation",
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = TargetUserId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.Reception,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = "{}"
        });
    }

    private static User CreateUser(
        int id,
        UserRole role,
        string identifier,
        bool isActive,
        int sessionVersion = 0,
        bool passwordSetupRequired = false) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword("password1"),
        Role = role,
        IsActive = isActive,
        SecurityStampVersion = sessionVersion,
        PasswordSetupRequired = passwordSetupRequired
    };

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));

    private const int AdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int TargetUserId = 3;
    private const int DestinationId = 10;
    private const int PropertyId = 100;
    private const string SetupToken = "setup-token";
}
