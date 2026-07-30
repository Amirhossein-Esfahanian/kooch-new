using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminUserHardeningTests
{
    [Fact]
    public async Task SingleActiveSuperAdmin_CannotDemoteSelf()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database, User(ActorId, UserRole.SuperAdmin));
        await using var context = database.CreateContext();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).UpdateUserAsync(
                ActorId,
                UserRole.SuperAdmin,
                ActorId,
                UpdateRequest(UserRole.AdminAssistant)));

        Assert.Contains("مدیر ارشد فعال", exception.Message);
        await AssertUserAsync(database, ActorId, UserRole.SuperAdmin, true);
    }

    [Fact]
    public async Task SingleActiveSuperAdmin_CannotBeDemotedByAnotherAuthorizedActor()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(
            database,
            User(TargetId, UserRole.SuperAdmin),
            User(ActorId, UserRole.SuperAdmin, isActive: false));
        await using var context = database.CreateContext();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).UpdateUserAsync(
                ActorId,
                UserRole.SuperAdmin,
                TargetId,
                UpdateRequest(UserRole.AdminAssistant)));

        await AssertUserAsync(database, TargetId, UserRole.SuperAdmin, true);
    }

    [Fact]
    public async Task SingleActiveSuperAdmin_CannotBeDeactivated()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(
            database,
            User(TargetId, UserRole.SuperAdmin),
            User(ActorId, UserRole.SuperAdmin, isActive: false));
        await using var context = database.CreateContext();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).SetActiveAsync(
                ActorId,
                UserRole.SuperAdmin,
                TargetId,
                false));

        await AssertUserAsync(database, TargetId, UserRole.SuperAdmin, true);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public async Task InactiveOrDeletedSuperAdmin_DoesNotSatisfyLastActiveInvariant(
        bool secondIsActive,
        bool secondIsDeleted)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(
            database,
            User(TargetId, UserRole.SuperAdmin),
            User(ActorId, UserRole.SuperAdmin, secondIsActive, secondIsDeleted));
        await using var context = database.CreateContext();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).UpdateUserAsync(
                ActorId,
                UserRole.SuperAdmin,
                TargetId,
                UpdateRequest(UserRole.AdminAssistant)));
    }

    [Fact]
    public async Task OneOfTwoActiveSuperAdmins_CanBeDemoted_AndBecomesRestrictable()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.SuperAdmin));
        await using (var context = database.CreateContext())
        {
            await CreateService(context).UpdateUserAsync(
                ActorId, UserRole.SuperAdmin, TargetId,
                UpdateRequest(UserRole.AdminAssistant));
        }

        await using var verification = database.CreateContext();
        var target = await verification.Users.IgnoreQueryFilters()
            .SingleAsync(user => user.Id == TargetId);
        Assert.Equal(UserRole.AdminAssistant, target.Role);
        Assert.True(target.CanBeRestricted);
    }

    [Fact]
    public async Task OneOfTwoActiveSuperAdmins_CanBeDeactivated()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.SuperAdmin));
        await using var context = database.CreateContext();

        await CreateService(context).SetActiveAsync(
            ActorId, UserRole.SuperAdmin, TargetId, false);

        await AssertUserAsync(database, TargetId, UserRole.SuperAdmin, false);
    }

    [Fact]
    public async Task LastSuperAdmin_CanChangeUnrelatedProfileFields()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database, User(ActorId, UserRole.SuperAdmin));
        await using var context = database.CreateContext();
        var request = UpdateRequest(UserRole.SuperAdmin);
        request.FirstName = "Updated";

        var response = await CreateService(context).UpdateUserAsync(
            ActorId, UserRole.SuperAdmin, ActorId, request);

        Assert.Equal("Updated", response.FirstName);
        Assert.Equal(UserRole.SuperAdmin, response.Role);
    }

    [Theory]
    [InlineData(UserRole.AdminAssistant)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task PropertyOwner_CannotBeDeactivated(UserRole targetRole)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, targetRole));
        await SeedPropertyAsync(database, TargetId);
        await using var context = database.CreateContext();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).SetActiveAsync(
                ActorId, UserRole.SuperAdmin, TargetId, false));

        Assert.Contains("مالکیت", exception.Message);
        await AssertUserAsync(database, TargetId, targetRole, true);
    }

    [Fact]
    public async Task NonOwnerAdminAssistant_CanBeDeactivated()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.AdminAssistant));
        await using var context = database.CreateContext();

        await CreateService(context).SetActiveAsync(
            ActorId, UserRole.SuperAdmin, TargetId, false);

        await AssertUserAsync(database, TargetId, UserRole.AdminAssistant, false);
    }

    [Fact]
    public async Task FormerOwner_CanBeDeactivatedAfterOwnershipTransfer()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.AdminAssistant));
        await SeedPropertyAsync(database, TargetId);
        await using (var transferContext = database.CreateContext())
        {
            var property = await transferContext.Properties.SingleAsync();
            property.OwnerId = ActorId;
            await transferContext.SaveChangesAsync();
        }

        await using var context = database.CreateContext();
        await CreateService(context).SetActiveAsync(
            ActorId, UserRole.SuperAdmin, TargetId, false);

        await AssertUserAsync(database, TargetId, UserRole.AdminAssistant, false);
    }

    [Fact]
    public async Task DeletedProperty_DoesNotBlockDeactivation()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.AdminAssistant));
        await SeedPropertyAsync(database, TargetId, isDeleted: true);
        await using var context = database.CreateContext();

        await CreateService(context).SetActiveAsync(
            ActorId, UserRole.SuperAdmin, TargetId, false);

        await AssertUserAsync(database, TargetId, UserRole.AdminAssistant, false);
    }

    [Fact]
    public async Task OwnerMembershipWithoutPropertyOwnerId_DoesNotBlockDeactivation()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.AdminAssistant));
        await SeedPropertyAsync(database, ActorId, membershipUserId: TargetId);
        await using var context = database.CreateContext();

        await CreateService(context).SetActiveAsync(
            ActorId, UserRole.SuperAdmin, TargetId, false);

        await AssertUserAsync(database, TargetId, UserRole.AdminAssistant, false);
    }

    [Fact]
    public async Task NormalQueries_ExcludeDeletedAndClients_ButIncludeInactiveAdmins()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.SuperAdmin),
            User(TargetId, UserRole.AdminAssistant, isActive: false),
            User(30, UserRole.AdminAssistant, isDeleted: true),
            User(31, UserRole.Client));
        await using var context = database.CreateContext();
        var service = CreateService(context);

        var users = await service.GetUsersAsync(ActorId, UserRole.SuperAdmin);

        Assert.Equal([ActorId, TargetId], users.Select(user => user.Id).Order().ToArray());
        Assert.False(users.Single(user => user.Id == TargetId).IsActive);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.GetUserAsync(ActorId, UserRole.SuperAdmin, 30));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AdminAssistant_CannotChangeSuperAdminStatus(bool activate)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.AdminAssistant),
            User(TargetId, UserRole.SuperAdmin, isActive: !activate));
        await GrantManageUsersAsync(database, ActorId);
        await using var context = database.CreateContext();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(context).SetActiveAsync(
                ActorId, UserRole.AdminAssistant, TargetId, activate));
    }

    [Fact]
    public async Task AdminAssistantWithoutManageUsers_IsDeniedFromAllOperations()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database,
            User(ActorId, UserRole.AdminAssistant),
            User(TargetId, UserRole.AdminAssistant),
            User(30, UserRole.SuperAdmin));
        await using var context = database.CreateContext();
        var service = CreateService(context);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetUsersAsync(ActorId, UserRole.AdminAssistant));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetUserAsync(ActorId, UserRole.AdminAssistant, TargetId));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.CreateUserAsync(
                ActorId, UserRole.AdminAssistant, CreateRequest("denied-create")));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.UpdateUserAsync(
                ActorId, UserRole.AdminAssistant, TargetId,
                UpdateRequest(UserRole.AdminAssistant)));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.SetActiveAsync(
                ActorId, UserRole.AdminAssistant, TargetId, false));
    }

    [Fact]
    public async Task Create_RollsBackWhenPermissionPersistenceFails()
    {
        var interceptor = new PermissionPersistenceFailureInterceptor();
        await using var database = await TestDatabase.CreateAsync(interceptor);
        await SeedUsersAsync(database, User(ActorId, UserRole.SuperAdmin));
        interceptor.Enabled = true;

        await using (var context = database.CreateContext())
        {
            var request = CreateRequest("rollback-create");
            request.Permissions = [PermissionKey.ManageUsers.ToString()];
            await Assert.ThrowsAsync<DbUpdateException>(() =>
                CreateService(context).CreateUserAsync(
                    ActorId, UserRole.SuperAdmin, request));
        }

        await using var verification = database.CreateContext();
        Assert.False(await verification.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.PhoneNumber == "09121110001"));
        Assert.Empty(await verification.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task Update_RollsBackRolePasswordStampAndPermissions()
    {
        var interceptor = new PermissionPersistenceFailureInterceptor();
        await using var database = await TestDatabase.CreateAsync(interceptor);
        var target = User(TargetId, UserRole.AdminAssistant);
        target.SecurityStampVersion = 5;
        target.PasswordHash = "original-hash";
        await SeedUsersAsync(database, User(ActorId, UserRole.SuperAdmin), target);
        await GrantManageUsersAsync(database, TargetId);
        await SeedPropertyAsync(database, ActorId);
        await using (var membershipContext = database.CreateContext())
        {
            membershipContext.UserPropertyAccesses.Add(new UserPropertyAccess
            {
                UserId = TargetId,
                PropertyId = 200,
                PropertyRole = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                PermissionMatrixJson = @"{""Bookings"":{""View"":true}}"
            });
            await membershipContext.SaveChangesAsync();
        }
        interceptor.Enabled = true;

        await using (var context = database.CreateContext())
        {
            var request = UpdateRequest(UserRole.SuperAdmin);
            request.Password = "changedpassword1";
            await Assert.ThrowsAsync<DbUpdateException>(() =>
                CreateService(context).UpdateUserAsync(
                    ActorId, UserRole.SuperAdmin, TargetId, request));
        }

        await using var verification = database.CreateContext();
        var persisted = await verification.Users.IgnoreQueryFilters()
            .SingleAsync(user => user.Id == TargetId);
        Assert.Equal(UserRole.AdminAssistant, persisted.Role);
        Assert.Equal(5, persisted.SecurityStampVersion);
        Assert.Equal("original-hash", persisted.PasswordHash);
        Assert.True(await verification.UserPermissions.AnyAsync(permission =>
            permission.UserId == TargetId && permission.IsAllowed));
        var membership = await verification.UserPropertyAccesses
            .SingleAsync(access => access.UserId == TargetId);
        Assert.Equal(PropertyUserRole.Reception, membership.PropertyRole);
        Assert.Equal(@"{""Bookings"":{""View"":true}}", membership.PermissionMatrixJson);
        Assert.Empty(await verification.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task SuccessfulCreate_PersistsInvitationThenNotifiesAndAudits()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedUsersAsync(database, User(ActorId, UserRole.SuperAdmin));
        await using var context = database.CreateContext();
        var notifications = new RecordingNotificationService(context);
        var service = CreateService(context, CreateAuthService(context, notifications));
        var request = CreateRequest("invited-admin");
        request.Password = null;

        var response = await service.CreateUserAsync(
            ActorId, UserRole.SuperAdmin, request);

        Assert.True(response.PasswordSetupRequired);
        Assert.NotNull(response.TemporarySetupLink);
        Assert.False(notifications.TransactionWasActive);
        Assert.Single(notifications.Requests);
        Assert.True(await context.PasswordSetupTokens
            .AnyAsync(token => token.UserId == response.Id));
        Assert.True(await context.AuditLogs.AnyAsync(log =>
            log.EntityId == response.Id &&
            log.Action == AuditAction.PlatformAdminCreated));
    }

    private static AdminUserService CreateService(
        KoochDbContext context,
        IAuthService? authService = null)
    {
        var authorization = new PropertyAccessService(context);
        var permissions = new PermissionService(context, authorization);
        return new AdminUserService(
            context,
            permissions,
            authService ?? new StubAuthService(),
            new AuditLogService(context, permissions),
            new TestHostEnvironment(),
            NullLogger<AdminUserService>.Instance);
    }

    private static AuthService CreateAuthService(
        KoochDbContext context,
        INotificationService notifications) =>
        new(
            context,
            Options.Create(new JwtOptions
            {
                Issuer = "kooch-tests",
                Audience = "kooch-tests",
                Key = "0123456789abcdef0123456789abcdef"
            }),
            new PropertyAccessService(context),
            new TestHostEnvironment(),
            notifications);

    private static AdminUserRequest CreateRequest(string identifier) => new()
    {
        FirstName = identifier,
        LastName = "Admin",
        Email = $"{identifier}@example.test",
        PhoneNumber = identifier == "rollback-create"
            ? "09121110001"
            : "09121110002",
        Password = "password1",
        Role = UserRole.AdminAssistant
    };

    private static AdminUserRequest UpdateRequest(UserRole role) => new()
    {
        FirstName = "Target",
        LastName = "Admin",
        Email = "user-2@example.test",
        PhoneNumber = "09120000002",
        Role = role
    };

    private static User User(
        int id,
        UserRole role,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        Id = id,
        FirstName = id == ActorId ? "Actor" : "Target",
        LastName = "Admin",
        Email = id == ActorId ? "actor@example.test" : $"user-{id}@example.test",
        PhoneNumber = id == ActorId ? "09120000001" : $"0912{id:0000000}",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive,
        IsDeleted = isDeleted,
        CanBeRestricted = role != UserRole.SuperAdmin
    };

    private static async Task SeedUsersAsync(
        TestDatabase database,
        params User[] users)
    {
        await using var context = database.CreateContext();
        context.Users.AddRange(users);
        await context.SaveChangesAsync();
    }

    private static async Task GrantManageUsersAsync(
        TestDatabase database,
        int userId)
    {
        await using var context = database.CreateContext();
        if (!await context.Permissions.AnyAsync(permission =>
                permission.Key == PermissionKey.ManageUsers))
        {
            context.Permissions.Add(new Permission
            {
                Key = PermissionKey.ManageUsers,
                Name = nameof(PermissionKey.ManageUsers)
            });
        }
        context.UserPermissions.Add(new UserPermission
        {
            UserId = userId,
            PermissionKey = PermissionKey.ManageUsers,
            IsAllowed = true
        });
        await context.SaveChangesAsync();
    }

    private static async Task SeedPropertyAsync(
        TestDatabase database,
        int ownerId,
        bool isDeleted = false,
        int? membershipUserId = null)
    {
        await using var context = database.CreateContext();
        context.Destinations.Add(new Destination
        {
            Id = 100,
            Name = "Test",
            Slug = "test",
            Country = "Iran"
        });
        context.Properties.Add(new Property
        {
            Id = 200,
            OwnerId = ownerId,
            DestinationId = 100,
            Name = "Test Property",
            Slug = "test-property",
            Description = "Test",
            Address = "Test",
            City = "Test",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms,
            IsDeleted = isDeleted
        });
        context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = membershipUserId ?? ownerId,
            PropertyId = 200,
            PropertyRole = PropertyUserRole.PropertyOwner,
            Status = PropertyUserStatus.Active,
            IsActive = true
        });
        await context.SaveChangesAsync();
    }

    private static async Task AssertUserAsync(
        TestDatabase database,
        int userId,
        UserRole role,
        bool isActive)
    {
        await using var context = database.CreateContext();
        var user = await context.Users.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == userId);
        Assert.Equal(role, user.Role);
        Assert.Equal(isActive, user.IsActive);
    }

    private sealed class PermissionPersistenceFailureInterceptor
        : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Enabled &&
                eventData.Context!.ChangeTracker.Entries<UserPermission>()
                    .Any(entry =>
                        entry.State is EntityState.Added or EntityState.Modified))
            {
                throw new DbUpdateException(
                    "Injected permission persistence failure.");
            }

            return base.SavingChangesAsync(
                eventData,
                result,
                cancellationToken);
        }
    }

    private sealed class RecordingNotificationService(KoochDbContext context)
        : INotificationService
    {
        public List<NotificationRequest> Requests { get; } = [];
        public bool TransactionWasActive { get; private set; }

        public Task SendAsync(
            NotificationRequest request,
            CancellationToken cancellationToken = default)
        {
            TransactionWasActive =
                context.Database.CurrentTransaction is not null;
            Requests.Add(request);
            return Task.CompletedTask;
        }
    }

    private sealed class StubAuthService : IAuthService
    {
        public Task<string> CreatePasswordSetupTokenAsync(
            int userId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult("setup-link");

        public Task<CurrentUserResponse?> GetCurrentUserAsync(
            int userId,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public string GenerateJwtToken(User user, DateTime expiresAtUtc) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> LoginAsync(
            LoginRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RegisterAsync(
            RegisterRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RequestOtpAsync(
            RequestOtpRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task SetPasswordAsync(
            SetPasswordRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PasswordSetupTokenStatusResponse>
            ValidatePasswordSetupTokenAsync(
                string token,
                CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> VerifyOtpAsync(
            VerifyOtpRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } =
            new NullFileProvider();
    }

    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection connection =
            new("Data Source=:memory:");
        private readonly SaveChangesInterceptor? interceptor;

        private TestDatabase(SaveChangesInterceptor? interceptor)
        {
            this.interceptor = interceptor;
            connection.Open();
        }

        public static async Task<TestDatabase> CreateAsync(
            SaveChangesInterceptor? interceptor = null)
        {
            var database = new TestDatabase(interceptor);
            await using var context = database.CreateContext();
            await context.Database.EnsureCreatedAsync();
            return database;
        }

        public KoochDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection);
            if (interceptor is not null)
            {
                options.AddInterceptors(interceptor);
            }

            return new KoochDbContext(options.Options);
        }

        public async ValueTask DisposeAsync() =>
            await connection.DisposeAsync();
    }

    private const int ActorId = 1;
    private const int TargetId = 2;
}
