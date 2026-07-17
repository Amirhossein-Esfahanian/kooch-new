using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CanonicalPropertyOwnerOnboardingTests
{
    [Fact]
    public async Task AdminPropertyCreation_AssignsClientOwnerAndCanonicalMembership()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        var created = await service.CreatePropertyAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            CreatePropertyRequest(OwnerUserId));

        var owner = await dbContext.Users.SingleAsync(user => user.Id == OwnerUserId);
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == created.Id &&
            access.UserId == OwnerUserId);
        var permissions = JsonSerializer.Deserialize<PermissionMatrixDto>(membership.PermissionMatrixJson);

        Assert.Equal(OwnerUserId, created.OwnerId);
        Assert.Equal(UserRole.Client, owner.Role);
        Assert.Equal(PropertyUserRole.PropertyOwner, membership.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, membership.Status);
        Assert.True(membership.IsActive);
        Assert.True(permissions!["Users"].Create);
        Assert.True(permissions["Settings"].Delete);
    }

    [Fact]
    public async Task AdminPropertyCreation_RejectsLegacyOrPlatformOwnerAccounts()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreatePropertyAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                CreatePropertyRequest(LegacyOwnerUserId)));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreatePropertyAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                CreatePropertyRequest(AdminUserId)));
    }

    [Theory]
    [InlineData(UserRole.Client)]
    [InlineData(UserRole.Owner)]
    public async Task PropertyCreation_IsAdminOnly(UserRole currentRole)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.CreatePropertyAsync(
                OwnerUserId,
                currentRole,
                CreatePropertyRequest(OwnerUserId)));
    }

    [Fact]
    public async Task OwnerAccountService_CreatesNormalClientAccountForPropertyOwnership()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateOwnerAccountService(dbContext);

        var created = await service.CreateAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            new AdminPropertyOwnerAccountRequest
            {
                FirstName = "New",
                LastName = "Owner",
                Email = "new-owner@example.test",
                PhoneNumber = "09120000099"
            });

        var user = await dbContext.Users.SingleAsync(item => item.Id == created.Id);
        Assert.Equal(UserRole.Client, user.Role);
        Assert.False(user.IsActive);
        Assert.True(user.PasswordSetupRequired);
        Assert.Equal("/set-password?token=test-token", created.TemporarySetupLink);
        Assert.False(await dbContext.UserPropertyAccesses.AnyAsync(access => access.UserId == created.Id));
    }

    [Fact]
    public async Task OwnerAccountCandidates_ReturnOnlyNormalClientAccounts()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateOwnerAccountService(dbContext);

        var candidates = await service.GetCandidatesAsync(AdminUserId, UserRole.SuperAdmin);

        Assert.Equal([OwnerUserId], candidates.Select(candidate => candidate.Id).ToArray());
    }

    private static PropertyService CreatePropertyService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyService(
            dbContext,
            authorization,
            authorization,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
    }

    private static AdminPropertyOwnerAccountService CreateOwnerAccountService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new AdminPropertyOwnerAccountService(
            dbContext,
            new PermissionService(dbContext, authorization),
            new StubAuthService(),
            new TestHostEnvironment());
    }

    private static async Task SeedBaseAsync(KoochDbContext dbContext)
    {
        dbContext.Users.AddRange(
            CreateUser(AdminUserId, UserRole.SuperAdmin, "admin", true),
            CreateUser(OwnerUserId, UserRole.Client, "client-owner", true),
            CreateUser(LegacyOwnerUserId, UserRole.Owner, "legacy-owner", true));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        await dbContext.SaveChangesAsync();
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static User CreateUser(int id, UserRole role, string identifier, bool isActive) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive
    };

    private static CreatePropertyRequest CreatePropertyRequest(int ownerId) => new()
    {
        OwnerId = ownerId,
        DestinationId = DestinationId,
        Name = $"Property {Guid.NewGuid():N}",
        Description = "Test property",
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private sealed class StubAuthService : IAuthService
    {
        public Task<string> CreatePasswordSetupTokenAsync(int userId, CancellationToken cancellationToken = default) =>
            Task.FromResult("/set-password?token=test-token");

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
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private const int AdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int LegacyOwnerUserId = 3;
    private const int DestinationId = 10;
}
