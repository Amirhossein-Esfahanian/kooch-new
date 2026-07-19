using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class JwtPlatformRoleClaimTests
{
    private const int LegacyOwnerId = 10;
    private const int LegacyAssistantId = 11;
    private const int LegacyAssistantWithoutMembershipId = 12;
    private const int PropertyId = 100;
    private const string Password = "password1";

    [Theory]
    [InlineData(LegacyOwnerId, "legacy-owner@example.test")]
    [InlineData(LegacyAssistantId, "legacy-assistant@example.test")]
    public async Task LegacyPropertyUserLogin_EmitsClientPlatformRoleClaim(
        int userId,
        string email)
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateAuthService(dbContext);

        var response = await service.LoginAsync(new LoginRequest
        {
            Identifier = email,
            Password = Password
        });

        Assert.NotNull(response);
        var principal = ValidateToken(response.Token);
        Assert.Equal(userId.ToString(), principal.FindFirstValue(ClaimTypes.NameIdentifier));
        Assert.True(principal.IsInRole(UserRole.Client.ToString()));
        Assert.False(principal.IsInRole(UserRole.Owner.ToString()));
        Assert.False(principal.IsInRole(UserRole.OwnerAssistant.ToString()));
    }

    [Theory]
    [InlineData(LegacyOwnerId, "legacy-owner@example.test")]
    [InlineData(LegacyAssistantId, "legacy-assistant@example.test")]
    public async Task CanonicalJwtClaim_AllowsAccountReservationPolicy(
        int userId,
        string email)
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreateAuthService(dbContext);
        var response = await service.LoginAsync(new LoginRequest
        {
            Identifier = email,
            Password = Password
        });

        Assert.NotNull(response);
        var principal = ValidateToken(response.Token);
        var requirement = new RolesAuthorizationRequirement([UserRole.Client.ToString()]);
        var context = new AuthorizationHandlerContext([requirement], principal, resource: null);

        await requirement.HandleAsync(context);

        Assert.Equal(userId.ToString(), principal.FindFirstValue(ClaimTypes.NameIdentifier));
        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task LegacyOwnerAssistant_OwnerWorkspaceAccess_ComesFromMembership()
    {
        await using var dbContext = await CreateContextAsync();
        var authService = CreateAuthService(dbContext);
        var propertyAccessService = new PropertyAccessService(dbContext);

        var currentUser = await authService.GetCurrentUserAsync(LegacyAssistantId);

        Assert.NotNull(currentUser);
        Assert.Equal(UserRole.Client, currentUser.PlatformRole);
        Assert.Contains(WorkspaceNames.Owner, currentUser.Workspaces);
        Assert.True(await propertyAccessService.CanAccessPropertyAsync(LegacyAssistantId, PropertyId));
        Assert.True(await propertyAccessService.CanAccessOwnerPanelAsync(LegacyAssistantId));
    }

    [Fact]
    public async Task LegacyOwnerAssistant_WithoutMembership_HasNoPropertyAccess()
    {
        await using var dbContext = await CreateContextAsync();
        var authService = CreateAuthService(dbContext);
        var propertyAccessService = new PropertyAccessService(dbContext);

        var currentUser = await authService.GetCurrentUserAsync(LegacyAssistantWithoutMembershipId);

        Assert.NotNull(currentUser);
        Assert.Equal(UserRole.Client, currentUser.PlatformRole);
        Assert.Equal([WorkspaceNames.Account], currentUser.Workspaces);
        Assert.False(await propertyAccessService.CanAccessPropertyAsync(
            LegacyAssistantWithoutMembershipId,
            PropertyId));
        Assert.False(await propertyAccessService.CanAccessOwnerPanelAsync(
            LegacyAssistantWithoutMembershipId));
    }

    private static AuthService CreateAuthService(KoochDbContext dbContext) => new(
        dbContext,
        Options.Create(JwtOptions),
        new PropertyAccessService(dbContext),
        null!,
        null!);

    private static ClaimsPrincipal ValidateToken(string token)
    {
        var principal = new JwtSecurityTokenHandler().ValidateToken(
            token,
            new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = JwtOptions.Issuer,
                ValidAudience = JwtOptions.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtOptions.Key)),
                ClockSkew = TimeSpan.Zero
            },
            out _);

        return principal;
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        var dbContext = new KoochDbContext(options);

        dbContext.Users.AddRange(
            CreateUser(LegacyOwnerId, UserRole.Owner, "legacy-owner"),
            CreateUser(LegacyAssistantId, UserRole.OwnerAssistant, "legacy-assistant"),
            CreateUser(
                LegacyAssistantWithoutMembershipId,
                UserRole.OwnerAssistant,
                "legacy-assistant-without-membership"));

        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = PropertyId,
            OwnerId = LegacyOwnerId,
            DestinationId = 1,
            Name = "Legacy owner property",
            Slug = "legacy-owner-property",
            Description = "Legacy owner property",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(1, LegacyOwnerId, PropertyUserRole.PropertyOwner),
            CreateMembership(2, LegacyAssistantId, PropertyUserRole.Manager));

        await dbContext.SaveChangesAsync();
        return dbContext;
    }

    private static User CreateUser(int id, UserRole role, string identifier) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(Password),
        Role = role,
        IsActive = true,
        PasswordSetupRequired = false
    };

    private static UserPropertyAccess CreateMembership(
        int id,
        int userId,
        PropertyUserRole role) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = PropertyId,
        PropertyRole = role,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = DashboardViewPermissionJson
    };

    private static readonly JwtOptions JwtOptions = new()
    {
        Key = "canonical-platform-role-tests-key-32-bytes-minimum",
        Issuer = "Kooch.Tests",
        Audience = "Kooch.Tests",
        ExpiresMinutes = 60,
        AccessTokenExpirationDays = 30
    };

    private static readonly string DashboardViewPermissionJson =
        System.Text.Json.JsonSerializer.Serialize(new PermissionMatrixDto
        {
            ["Dashboard"] = new PermissionActionsDto { View = true }
        });
}
