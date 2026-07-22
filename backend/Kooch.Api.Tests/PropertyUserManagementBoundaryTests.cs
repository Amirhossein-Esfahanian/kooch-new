using System.Security.Cryptography;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
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
                PhoneNumber = "09120001001",
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
                PhoneNumber = "09120001002",
                Role = UserRole.AdminAssistant
            });

        var preserved = await dbContext.UserPropertyAccesses.SingleAsync();
        Assert.Equal(PropertyUserRole.Reception, preserved.PropertyRole);
        Assert.Equal(PropertyUserStatus.Suspended, preserved.Status);
        Assert.False(preserved.IsActive);
        Assert.Equal("{\"Bookings\":{\"View\":true}}", preserved.PermissionMatrixJson);
    }

    [Fact]
    public async Task AdminAssistantWithCanonicalManageUsersPermission_CanCreateAdminAssistant()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(1, UserRole.AdminAssistant, "admin-assistant"));
        dbContext.UserPermissions.Add(new UserPermission
        {
            UserId = 1,
            PermissionKey = PermissionKey.ManageUsers,
            IsAllowed = true
        });
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        var created = await service.CreateUserAsync(
            1,
            UserRole.AdminAssistant,
            new AdminUserRequest
            {
                FirstName = "Created",
                LastName = "Assistant",
                Email = "created-assistant@example.test",
                PhoneNumber = "09120001003",
                Password = "password1",
                Role = UserRole.AdminAssistant
            });

        Assert.Equal(UserRole.AdminAssistant, created.Role);
    }
    [Fact]
    public async Task AdminAssistantWithoutCanonicalManageUsersPermission_CannotCreateAdminAssistant()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(1, UserRole.AdminAssistant, "admin-assistant"));
        await dbContext.SaveChangesAsync();
        var service = CreateAdminUserService(dbContext);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateUserAsync(
            1,
            UserRole.AdminAssistant,
            new AdminUserRequest
            {
                FirstName = "Denied",
                LastName = "Assistant",
                Email = "denied-assistant@example.test",
                PhoneNumber = "09120001004",
                Password = "password1",
                Role = UserRole.AdminAssistant
            }));
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
                PhoneNumber = "09120001005",
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
                Mobile = "09120002001",
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
                Mobile = "09120002002",
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

    [Fact]
    public async Task PropertyUserCreate_NewUserCreatesClientAccountMembershipAndInvitation()
    {
        await using var dbContext = CreateContext();
        SeedProperty(dbContext);
        await dbContext.SaveChangesAsync();
        var authService = new RecordingAuthService();
        var service = CreatePropertyUserService(dbContext, authService, new TestHostEnvironment
        {
            EnvironmentName = Environments.Development
        });

        var created = await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new PropertyUserRequest
            {
                                FullName = "Invited Staff",
                Email = "invited-staff@example.test",
                Mobile = "09120002003",
                Role = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Pending,
                IsActive = false,
                Permissions = new PermissionMatrixDto
                {
                    ["Dashboard"] = new PermissionActionsDto { View = true }
                }
            });

        var user = await dbContext.Users.SingleAsync(user => user.Id == created.UserId);
        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.UserId == created.UserId);
        Assert.Equal(UserRole.Client, user.Role);
        Assert.False(user.IsActive);
        Assert.True(user.PasswordSetupRequired);
        Assert.Equal(PropertyUserRole.Reception, membership.PropertyRole);
        Assert.Equal(PropertyUserStatus.Pending, membership.Status);
        Assert.False(membership.IsActive);
        Assert.Equal([created.UserId], authService.TokenUserIds);
        Assert.Equal("setup-link-" + created.UserId, created.TemporarySetupLink);
    }

    [Fact]
    public async Task PropertyUserCreate_ExistingUserWithPasswordDoesNotRequireSetupAgain()
    {
        await using var dbContext = CreateContext();
        SeedProperty(dbContext);
        dbContext.Users.Add(new User
        {
            Id = 20,
            FirstName = "Existing",
            LastName = "Client",
            Email = "existing-client@example.test",
            PhoneNumber = "09120002004",
            PasswordHash = "existing-password-hash",
            Role = UserRole.Client,
            IsActive = true,
            PasswordSetupRequired = false
        });
        await dbContext.SaveChangesAsync();
        var authService = new RecordingAuthService();
        var service = CreatePropertyUserService(dbContext, authService, new TestHostEnvironment
        {
            EnvironmentName = Environments.Development
        });

        var created = await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new PropertyUserRequest
            {
                                FullName = "Ignored Name",
                Email = "existing-client@example.test",
                Mobile = "09120002004",
                Role = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                Permissions = new PermissionMatrixDto
                {
                    ["Dashboard"] = new PermissionActionsDto { View = true }
                }
            });

        var user = await dbContext.Users.SingleAsync(user => user.Id == 20);
        Assert.Equal(20, created.UserId);
        Assert.True(user.IsActive);
        Assert.False(user.PasswordSetupRequired);
        Assert.Empty(authService.TokenUserIds);
        Assert.Null(created.TemporarySetupLink);
        Assert.True(await dbContext.UserPropertyAccesses.AnyAsync(access => access.UserId == 20 && access.PropertyId == 100));
    }

    [Fact]
    public async Task PropertyUserCreate_AllowsExistingClientAcrossMultiplePropertyMemberships()
    {
        await using var dbContext = CreateContext();
        SeedProperty(dbContext);
        dbContext.Properties.Add(new Property
        {
            Id = 200,
            OwnerId = 2,
            DestinationId = 10,
            Name = "Second property",
            Slug = "second-property",
            Description = "Second property",
            Address = "Second address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.Users.Add(new User
        {
            Id = 30,
            FirstName = "Multi",
            LastName = "Member",
            Email = "multi-member@example.test",
            PhoneNumber = "09120002005",
            PasswordHash = "existing-password-hash",
            Role = UserRole.Client,
            IsActive = true,
            PasswordSetupRequired = false
        });
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = 30,
            PropertyId = 200,
            PropertyRole = PropertyUserRole.Accounting,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = "{}"
        });
        await dbContext.SaveChangesAsync();
        var service = CreatePropertyUserService(dbContext, new RecordingAuthService());

        await service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            100,
            new PropertyUserRequest
            {
                                FullName = "Multi Member",
                Email = "multi-member@example.test",
                Mobile = "09120002005",
                Role = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Suspended,
                IsActive = false,
                Permissions = new PermissionMatrixDto
                {
                    ["Dashboard"] = new PermissionActionsDto { View = true }
                }
            });

        var memberships = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == 30)
            .OrderBy(access => access.PropertyId)
            .ToListAsync();
        Assert.Equal([100, 200], memberships.Select(access => access.PropertyId).ToArray());
        Assert.Equal(PropertyUserRole.Reception, memberships[0].PropertyRole);
        Assert.Equal(PropertyUserStatus.Suspended, memberships[0].Status);
        Assert.Equal(PropertyUserRole.Accounting, memberships[1].PropertyRole);
    }

    [Fact]
    public async Task ResendInvitation_ReissuesSetupLinkAndLeavesMembershipStatusUnchanged()
    {
        await using var dbContext = CreateContext();
        SeedProperty(dbContext);
        dbContext.Users.Add(new User
        {
            Id = 40,
            FirstName = "Pending",
            LastName = "Invite",
            Email = "pending-invite@example.test",
            PasswordHash = "",
            Role = UserRole.Client,
            IsActive = false,
            PasswordSetupRequired = true
        });
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = 40,
            PropertyId = 100,
            PropertyRole = PropertyUserRole.Reception,
            Status = PropertyUserStatus.Suspended,
            IsActive = false,
            PermissionMatrixJson = "{}"
        });
        await dbContext.SaveChangesAsync();
        var authService = new RecordingAuthService();
        var service = CreatePropertyUserService(dbContext, authService, new TestHostEnvironment
        {
            EnvironmentName = Environments.Development
        });

        var response = await service.ResendInvitationAsync(1, UserRole.SuperAdmin, 100, 40);

        var membership = await dbContext.UserPropertyAccesses.SingleAsync(access => access.UserId == 40 && access.PropertyId == 100);
        Assert.Equal([40], authService.TokenUserIds);
        Assert.Equal("setup-link-40", response.TemporarySetupLink);
        Assert.Equal(PropertyUserStatus.Suspended, membership.Status);
        Assert.False(membership.IsActive);
    }

    [Fact]
    public async Task PasswordSetup_ExpiredTokenIsRejected()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(new User
        {
            Id = 50,
            FirstName = "Expired",
            LastName = "Token",
            Email = "expired-token@example.test",
            PasswordHash = "",
            Role = UserRole.Client,
            IsActive = false,
            PasswordSetupRequired = true
        });
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = 50,
            TokenHash = HashToken("expired-token"),
            ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-5)
        });
        await dbContext.SaveChangesAsync();
        var service = CreateAuthService(dbContext);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetPasswordAsync(new SetPasswordRequest
        {
            Token = "expired-token",
            NewPassword = "newpassword1",
            ConfirmPassword = "newpassword1"
        }));

        var user = await dbContext.Users.SingleAsync(user => user.Id == 50);
        Assert.False(user.IsActive);
        Assert.True(user.PasswordSetupRequired);
    }

    [Fact]
    public async Task PasswordSetup_ReissuedTokenInvalidatesPreviousActiveToken()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(new User
        {
            Id = 60,
            FirstName = "Reissued",
            LastName = "Token",
            Email = "reissued-token@example.test",
            PasswordHash = "",
            Role = UserRole.Client,
            IsActive = false,
            PasswordSetupRequired = true
        });
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = 60,
            TokenHash = HashToken("old-active-token"),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        await dbContext.SaveChangesAsync();
        var service = CreateAuthService(dbContext);

        await service.CreatePasswordSetupTokenAsync(60);

        var tokens = await dbContext.PasswordSetupTokens
            .Where(token => token.UserId == 60)
            .OrderBy(token => token.Id)
            .ToListAsync();
        Assert.Equal(2, tokens.Count);
        Assert.NotNull(tokens[0].UsedAtUtc);
        Assert.Null(tokens[1].UsedAtUtc);
        Assert.True(tokens[1].ExpiresAtUtc > DateTime.UtcNow);
    }
    [Fact]
    public async Task PasswordSetup_ValidationReturnsExplicitStates()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.AddRange(
            new User
            {
                Id = 70,
                FirstName = "Valid",
                LastName = "Token",
                Email = "valid-token@example.test",
                PasswordHash = "",
                Role = UserRole.Client,
                IsActive = false,
                PasswordSetupRequired = true
            },
            new User
            {
                Id = 71,
                FirstName = "Expired",
                LastName = "Token",
                Email = "expired-status@example.test",
                PasswordHash = "",
                Role = UserRole.Client,
                IsActive = false,
                PasswordSetupRequired = true
            },
            new User
            {
                Id = 72,
                FirstName = "Used",
                LastName = "Token",
                Email = "used-token@example.test",
                PasswordHash = "",
                Role = UserRole.Client,
                IsActive = false,
                PasswordSetupRequired = true
            });
        dbContext.PasswordSetupTokens.AddRange(
            new PasswordSetupToken
            {
                UserId = 70,
                TokenHash = HashToken("valid-token"),
                ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
            },
            new PasswordSetupToken
            {
                UserId = 71,
                TokenHash = HashToken("expired-token"),
                ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-5)
            },
            new PasswordSetupToken
            {
                UserId = 72,
                TokenHash = HashToken("used-token"),
                ExpiresAtUtc = DateTime.UtcNow.AddHours(1),
                UsedAtUtc = DateTime.UtcNow.AddMinutes(-1)
            });
        await dbContext.SaveChangesAsync();
        var service = CreateAuthService(dbContext);

        Assert.Equal(PasswordSetupTokenStatus.Valid, (await service.ValidatePasswordSetupTokenAsync("valid-token")).Status);
        Assert.Equal(PasswordSetupTokenStatus.Expired, (await service.ValidatePasswordSetupTokenAsync("expired-token")).Status);
        Assert.Equal(PasswordSetupTokenStatus.Used, (await service.ValidatePasswordSetupTokenAsync("used-token")).Status);
        Assert.Equal(PasswordSetupTokenStatus.Invalid, (await service.ValidatePasswordSetupTokenAsync("missing-token")).Status);
    }

    [Fact]
    public async Task PasswordSetup_SuccessConsumesTokenAndDoesNotActivateMemberships()
    {
        await using var dbContext = CreateContext();
        SeedProperty(dbContext);
        dbContext.Properties.Add(new Property
        {
            Id = 200,
            OwnerId = 2,
            DestinationId = 10,
            Name = "Second property",
            Slug = "second-property-password-setup",
            Description = "Second property",
            Address = "Second address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.Users.Add(new User
        {
            Id = 80,
            FirstName = "Setup",
            LastName = "User",
            Email = "setup-user@example.test",
            PasswordHash = "",
            Role = UserRole.Client,
            IsActive = false,
            PasswordSetupRequired = true
        });
        dbContext.UserPropertyAccesses.AddRange(
            new UserPropertyAccess
            {
                UserId = 80,
                PropertyId = 100,
                PropertyRole = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Pending,
                IsActive = false,
                PermissionMatrixJson = "{}"
            },
            new UserPropertyAccess
            {
                UserId = 80,
                PropertyId = 200,
                PropertyRole = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Suspended,
                IsActive = false,
                PermissionMatrixJson = "{}"
            });
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = 80,
            TokenHash = HashToken("single-use-token"),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        await dbContext.SaveChangesAsync();
        var service = CreateAuthService(dbContext);

        await service.SetPasswordAsync(new SetPasswordRequest
        {
            Token = "single-use-token",
            NewPassword = "newpassword1",
            ConfirmPassword = "newpassword1"
        });

        var user = await dbContext.Users.SingleAsync(user => user.Id == 80);
        var token = await dbContext.PasswordSetupTokens.SingleAsync(token => token.UserId == 80);
        var memberships = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == 80)
            .OrderBy(access => access.PropertyId)
            .ToListAsync();
        Assert.True(BCrypt.Net.BCrypt.Verify("newpassword1", user.PasswordHash));
        Assert.False(user.PasswordSetupRequired);
        Assert.NotNull(user.InvitationAcceptedAtUtc);
        Assert.True(user.IsActive);
        Assert.NotNull(token.UsedAtUtc);
        Assert.Equal(PropertyUserStatus.Pending, memberships[0].Status);
        Assert.False(memberships[0].IsActive);
        Assert.Equal(PropertyUserStatus.Suspended, memberships[1].Status);
        Assert.False(memberships[1].IsActive);
        Assert.Equal(PasswordSetupTokenStatus.Used, (await service.ValidatePasswordSetupTokenAsync("single-use-token")).Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetPasswordAsync(new SetPasswordRequest
        {
            Token = "single-use-token",
            NewPassword = "anotherpassword1",
            ConfirmPassword = "anotherpassword1"
        }));
    }

    private static PropertyUserService CreatePropertyUserService(
        KoochDbContext dbContext,
        IAuthService? authService = null,
        IHostEnvironment? hostEnvironment = null)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyUserService(
            dbContext,
            authorization,
            authService ?? new StubAuthService(),
            hostEnvironment ?? new TestHostEnvironment());
    }

    private static AuthService CreateAuthService(KoochDbContext dbContext) => new(
        dbContext,
        Options.Create(new JwtOptions
        {
            Issuer = "kooch-tests",
            Audience = "kooch-tests",
            Key = "0123456789abcdef0123456789abcdef"
        }),
        new PropertyAccessService(dbContext),
        new TestHostEnvironment(),
        new RecordingNotificationService());

    private static void SeedProperty(KoochDbContext dbContext)
    {
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
    }

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token.Trim()));
        return Convert.ToHexString(bytes);
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

    private sealed class RecordingAuthService : IAuthService
    {
        public List<int> TokenUserIds { get; } = [];

        public Task<string> CreatePasswordSetupTokenAsync(int userId, CancellationToken cancellationToken = default)
        {
            TokenUserIds.Add(userId);
            return Task.FromResult($"setup-link-{userId}");
        }

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

    private sealed class RecordingNotificationService : INotificationService
    {
        public List<NotificationRequest> Requests { get; } = [];

        public Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.CompletedTask;
        }
    }
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

        public Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(string token, CancellationToken cancellationToken = default) =>
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





