using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AccountMembershipStatusSeparationTests
{
    [Theory]
    [InlineData(PropertyUserStatus.Active, true)]
    [InlineData(PropertyUserStatus.Suspended, false)]
    [InlineData(PropertyUserStatus.Inactive, false)]
    public async Task MembershipStatusChange_DoesNotChangeAccountOrOtherMembership(
        PropertyUserStatus status,
        bool expectedMembershipIsActive)
    {
        await using var dbContext = await CreateContextAsync();
        var targetAccess = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.UserId == TargetUserId && access.PropertyId == FirstPropertyId);
        targetAccess.Status = status == PropertyUserStatus.Active
            ? PropertyUserStatus.Suspended
            : PropertyUserStatus.Active;
        targetAccess.IsActive = status != PropertyUserStatus.Active;
        await dbContext.SaveChangesAsync();
        var service = CreatePropertyUserService(dbContext);

        await service.SetStatusAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            FirstPropertyId,
            TargetUserId,
            status);

        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == TargetUserId);
        var memberships = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == TargetUserId)
            .OrderBy(access => access.PropertyId)
            .ToListAsync();
        Assert.True(user.IsActive);
        Assert.Equal(status, memberships[0].Status);
        Assert.Equal(expectedMembershipIsActive, memberships[0].IsActive);
        Assert.Equal(PropertyUserStatus.Active, memberships[1].Status);
        Assert.True(memberships[1].IsActive);
    }

    [Fact]
    public async Task MembershipEdit_DoesNotChangeAccountOrOtherMembership()
    {
        await using var dbContext = await CreateContextAsync();
        var service = CreatePropertyUserService(dbContext);

        await service.UpdateUserAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            FirstPropertyId,
            TargetUserId,
            new PropertyUserRequest
            {
                FullName = "Property Staff",
                Email = "staff@example.test",
                Role = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Suspended,
                IsActive = false
            });

        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == TargetUserId);
        var otherMembership = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.UserId == TargetUserId && access.PropertyId == SecondPropertyId);
        Assert.True(user.IsActive);
        Assert.Equal(PropertyUserStatus.Active, otherMembership.Status);
        Assert.True(otherMembership.IsActive);
    }

    [Fact]
    public async Task PasswordSetup_ActivatesAccountWithoutActivatingMemberships()
    {
        await using var dbContext = await CreateContextAsync();
        var user = await dbContext.Users.SingleAsync(item => item.Id == TargetUserId);
        user.IsActive = false;
        user.PasswordSetupRequired = true;
        var memberships = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == TargetUserId)
            .OrderBy(access => access.PropertyId)
            .ToListAsync();
        memberships[0].Status = PropertyUserStatus.Pending;
        memberships[0].IsActive = false;
        memberships[1].Status = PropertyUserStatus.Suspended;
        memberships[1].IsActive = false;
        const string token = "account-setup-token";
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = TargetUserId,
            TokenHash = HashToken(token),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        await dbContext.SaveChangesAsync();
        var service = new AuthService(
            dbContext,
            Options.Create(new JwtOptions()),
            new PropertyAccessService(dbContext),
            null!,
            null!);

        await service.SetPasswordAsync(new SetPasswordRequest
        {
            Token = token,
            NewPassword = "newpassword1",
            ConfirmPassword = "newpassword1"
        });

        Assert.True(user.IsActive);
        Assert.False(user.PasswordSetupRequired);
        Assert.Equal(PropertyUserStatus.Pending, memberships[0].Status);
        Assert.False(memberships[0].IsActive);
        Assert.Equal(PropertyUserStatus.Suspended, memberships[1].Status);
        Assert.False(memberships[1].IsActive);
    }

    private static PropertyUserService CreatePropertyUserService(KoochDbContext dbContext)
    {
        var propertyAuthorizationService = new PropertyAccessService(dbContext);
        return new PropertyUserService(
            dbContext,
            new PermissionService(dbContext, propertyAuthorizationService),
            propertyAuthorizationService,
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
            CreateUser(AdminUserId, UserRole.SuperAdmin, "admin"),
            CreateUser(OwnerUserId, UserRole.Owner, "owner"),
            CreateUser(TargetUserId, UserRole.OwnerAssistant, "staff"));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(FirstPropertyId, "First property"),
            CreateProperty(SecondPropertyId, "Second property"));
        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(FirstPropertyId),
            CreateMembership(SecondPropertyId));
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

    private static Property CreateProperty(int id, string name) => new()
    {
        Id = id,
        OwnerId = OwnerUserId,
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

    private static UserPropertyAccess CreateMembership(int propertyId) => new()
    {
        UserId = TargetUserId,
        PropertyId = propertyId,
        PropertyRole = PropertyUserRole.Manager,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = "{}"
    };

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private const int AdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int TargetUserId = 3;
    private const int DestinationId = 10;
    private const int FirstPropertyId = 101;
    private const int SecondPropertyId = 202;
}
