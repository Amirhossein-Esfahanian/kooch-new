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

    [Fact]
    public async Task TransferOwnership_ExistingClientPromotesNewOwnerAndDemotesPreviousOwner()
    {
        await using var dbContext = CreateContext();
        await SeedTransferPropertyAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        var updated = await service.TransferOwnershipAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            TransferPropertyId,
            new AdminTransferPropertyOwnershipRequest
            {
                NewOwnerId = NewOwnerUserId,
                PreviousOwnerAction = PreviousOwnerTransferAction.Demote,
                PreviousOwnerRole = PropertyUserRole.Manager
            });

        var memberships = await dbContext.UserPropertyAccesses
            .Where(access => access.PropertyId == TransferPropertyId)
            .OrderBy(access => access.UserId)
            .ToListAsync();
        var previousOwner = memberships.Single(access => access.UserId == OwnerUserId);
        var newOwner = memberships.Single(access => access.UserId == NewOwnerUserId);
        var staff = memberships.Single(access => access.UserId == StaffUserId);
        var newOwnerPermissions = JsonSerializer.Deserialize<PermissionMatrixDto>(newOwner.PermissionMatrixJson)!;

        Assert.Equal(NewOwnerUserId, updated.OwnerId);
        Assert.Equal(PropertyUserRole.PropertyOwner, newOwner.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, newOwner.Status);
        Assert.True(newOwner.IsActive);
        Assert.True(newOwnerPermissions["Users"].Create);
        Assert.True(newOwnerPermissions["Settings"].Delete);
        Assert.Equal(PropertyUserRole.Manager, previousOwner.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, previousOwner.Status);
        Assert.True(previousOwner.IsActive);
        Assert.Equal(PropertyUserRole.Reception, staff.PropertyRole);
        Assert.True(staff.IsActive);
        Assert.Single(memberships, access =>
            access.PropertyRole == PropertyUserRole.PropertyOwner &&
            access.Status == PropertyUserStatus.Active &&
            access.IsActive);
        Assert.Contains(await dbContext.AuditLogs.ToListAsync(), log =>
            log.Action == AuditAction.PropertyOwnershipTransferred &&
            log.PropertyId == TransferPropertyId &&
            log.UserId == AdminUserId);
    }

    [Fact]
    public async Task TransferOwnership_NewClientCreatesAccountPromotesOwnerAndDeactivatesPreviousOwner()
    {
        await using var dbContext = CreateContext();
        await SeedTransferPropertyAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        var updated = await service.TransferOwnershipAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            TransferPropertyId,
            new AdminTransferPropertyOwnershipRequest
            {
                NewOwner = new AdminPropertyOwnerAccountRequest
                {
                    FirstName = "Created",
                    LastName = "Owner",
                    Email = "created-transfer-owner@example.test",
                    PhoneNumber = "09120000123",
                    Password = "password1"
                },
                PreviousOwnerAction = PreviousOwnerTransferAction.DeactivateMembership
            });

        var createdOwner = await dbContext.Users.SingleAsync(user => user.Email == "created-transfer-owner@example.test");
        var previousOwner = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == TransferPropertyId && access.UserId == OwnerUserId);
        var ownerMembership = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == TransferPropertyId && access.UserId == createdOwner.Id);

        Assert.Equal(createdOwner.Id, updated.OwnerId);
        Assert.Equal(UserRole.Client, createdOwner.Role);
        Assert.True(createdOwner.IsActive);
        Assert.False(createdOwner.PasswordSetupRequired);
        Assert.Equal(PropertyUserRole.PropertyOwner, ownerMembership.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, ownerMembership.Status);
        Assert.True(ownerMembership.IsActive);
        Assert.Equal(PropertyUserStatus.Inactive, previousOwner.Status);
        Assert.False(previousOwner.IsActive);
        Assert.Single(await dbContext.UserPropertyAccesses.Where(access =>
            access.PropertyId == TransferPropertyId &&
            access.PropertyRole == PropertyUserRole.PropertyOwner &&
            access.Status == PropertyUserStatus.Active &&
            access.IsActive).ToListAsync());
    }

    [Fact]
    public async Task TransferOwnership_RejectsInactiveUser()
    {
        await using var dbContext = CreateContext();
        await SeedTransferPropertyAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.TransferOwnershipAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            TransferPropertyId,
            new AdminTransferPropertyOwnershipRequest
            {
                NewOwnerId = InactiveUserId,
                PreviousOwnerAction = PreviousOwnerTransferAction.DeactivateMembership
            }));

        var property = await dbContext.Properties.SingleAsync(property => property.Id == TransferPropertyId);
        var previousOwner = await dbContext.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == TransferPropertyId && access.UserId == OwnerUserId);
        Assert.Equal(OwnerUserId, property.OwnerId);
        Assert.Equal(PropertyUserRole.PropertyOwner, previousOwner.PropertyRole);
        Assert.Equal(PropertyUserStatus.Active, previousOwner.Status);
        Assert.True(previousOwner.IsActive);
    }

    private static async Task SeedTransferPropertyAsync(KoochDbContext dbContext)
    {
        await SeedBaseAsync(dbContext);
        dbContext.Users.AddRange(
            CreateUser(NewOwnerUserId, UserRole.Client, "new-owner", true),
            CreateUser(StaffUserId, UserRole.Client, "staff", true),
            CreateUser(InactiveUserId, UserRole.Client, "inactive-owner", false));
        dbContext.Properties.Add(new Property
        {
            Id = TransferPropertyId,
            OwnerId = OwnerUserId,
            DestinationId = DestinationId,
            Name = "Transfer property",
            Slug = "transfer-property",
            Description = "Transfer property",
            Address = "Transfer address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.UserPropertyAccesses.AddRange(
            new UserPropertyAccess
            {
                UserId = OwnerUserId,
                PropertyId = TransferPropertyId,
                PropertyRole = PropertyUserRole.PropertyOwner,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
                {
                    ["Users"] = new PermissionActionsDto { View = true, Create = true, Edit = true, Delete = true, Export = true },
                    ["Settings"] = new PermissionActionsDto { View = true, Create = true, Edit = true, Delete = true, Export = true }
                })
            },
            new UserPropertyAccess
            {
                UserId = StaffUserId,
                PropertyId = TransferPropertyId,
                PropertyRole = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                PermissionMatrixJson = "{}"
            });
        await dbContext.SaveChangesAsync();
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

        public Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(string token, CancellationToken cancellationToken = default) =>
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
    private const int NewOwnerUserId = 4;
    private const int StaffUserId = 5;
    private const int InactiveUserId = 6;
    private const int DestinationId = 10;
    private const int TransferPropertyId = 100;
}
