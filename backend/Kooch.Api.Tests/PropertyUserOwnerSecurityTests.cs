using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyUserOwnerSecurityTests
{
    [Fact]
    public async Task Owner_SeesOnlyOwnPropertyMembers_AndCannotChangePropertyId()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Context.Users.Add(CreateUser(ExistingUserId, UserRole.Client, "member", "09121111111"));
        database.Context.UserPropertyAccesses.Add(CreateMembership(
            ExistingUserId,
            FirstPropertyId,
            PropertyUserRole.Reception,
            PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Reception)));
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        var members = await service.GetUsersAsync(
            OwnerUserId,
            UserRole.Client,
            FirstPropertyId);

        Assert.Contains(members, member => member.UserId == ExistingUserId);
        Assert.All(members, member => Assert.Equal(FirstPropertyId, member.PropertyId));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetUsersAsync(OwnerUserId, UserRole.Client, SecondPropertyId));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ResolveCandidateAsync(
                OwnerUserId,
                SecondPropertyId,
                new PropertyUserCandidateRequest { Mobile = "09121111111" }));
    }

    [Fact]
    public async Task CandidateResponse_DoesNotExposeEmailRoleDeletionOrOtherMemberships()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Context.Users.AddRange(
            CreateUser(ExistingUserId, UserRole.AdminAssistant, "platform-admin", "09122222222"),
            CreateUser(DeletedUserId, UserRole.Client, "deleted", "09123333333", isDeleted: true));
        database.Context.UserPropertyAccesses.Add(CreateMembership(
            ExistingUserId,
            SecondPropertyId,
            PropertyUserRole.Accounting,
            PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Accounting)));
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        var existing = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09122222222" });
        var deleted = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09123333333" });

        Assert.Equal(PropertyUserCandidateOutcome.CanContinue, existing.Outcome);
        Assert.False(existing.RequiresUserCreation);
        Assert.Equal("p*** u***", existing.MaskedName);
        Assert.Equal(PropertyUserCandidateOutcome.Unavailable, deleted.Outcome);
        Assert.Null(deleted.MaskedName);
        Assert.DoesNotContain("Admin", JsonSerializer.Serialize(existing));
        Assert.DoesNotContain("@", JsonSerializer.Serialize(existing));
        Assert.DoesNotContain(SecondPropertyId.ToString(), JsonSerializer.Serialize(existing));
        Assert.Equal(
            ["MaskedName", "Outcome", "RequiresUserCreation"],
            typeof(PropertyUserCandidateResponse)
                .GetProperties(BindingFlags.Instance | BindingFlags.Public)
                .Select(property => property.Name)
                .OrderBy(name => name));
    }

    [Fact]
    public async Task UnknownMobile_CanContinueOnlyWithNewUserCreation()
    {
        await using var database = await TestDatabase.CreateAsync();
        var service = CreateService(database.Context);

        var candidate = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09129990001" });

        Assert.Equal(PropertyUserCandidateOutcome.CanContinue, candidate.Outcome);
        Assert.True(candidate.RequiresUserCreation);
        Assert.Null(candidate.MaskedName);
    }

    [Fact]
    public async Task GuestConflictingIdentity_IsUnavailableWithoutIdentityDetails()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Guest",
            LastName = "Identity",
            Mobile = "+989129990002",
            NormalizedMobile = "09129990002",
            Email = "guest@example.test"
        });
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        var candidate = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09129990002" });

        Assert.Equal(PropertyUserCandidateOutcome.Unavailable, candidate.Outcome);
        Assert.False(candidate.RequiresUserCreation);
        Assert.Null(candidate.MaskedName);
        Assert.DoesNotContain("Guest", JsonSerializer.Serialize(candidate));
        Assert.DoesNotContain("guest@example.test", JsonSerializer.Serialize(candidate));
    }

    [Fact]
    public async Task AmbiguousNormalizedMatches_AreUnavailableWithoutIdentityDetails()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Context.Users.AddRange(
            CreateUser(ExistingUserId, UserRole.Client, "first-match", "09129990003"),
            CreateUser(DeletedUserId, UserRole.Client, "second-match", "+989129990003"));
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        var candidate = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09129990003" });

        Assert.Equal(PropertyUserCandidateOutcome.Unavailable, candidate.Outcome);
        Assert.False(candidate.RequiresUserCreation);
        Assert.Null(candidate.MaskedName);
        Assert.DoesNotContain("match", JsonSerializer.Serialize(candidate));
    }

    [Fact]
    public async Task RepeatedLookupAttempts_ReturnTheSameMinimalResponse()
    {
        await using var database = await TestDatabase.CreateAsync();
        var service = CreateService(database.Context);

        var responses = new List<PropertyUserCandidateResponse>();
        for (var attempt = 0; attempt < PropertyUserResolveRateLimitPolicy.PermitLimit; attempt++)
        {
            responses.Add(await service.ResolveCandidateAsync(
                OwnerUserId,
                FirstPropertyId,
                new PropertyUserCandidateRequest { Mobile = "09129990004" }));
        }

        Assert.All(responses, candidate =>
        {
            Assert.Equal(PropertyUserCandidateOutcome.CanContinue, candidate.Outcome);
            Assert.True(candidate.RequiresUserCreation);
            Assert.Null(candidate.MaskedName);
        });
    }

    [Theory]
    [InlineData(typeof(PropertyUsersController))]
    [InlineData(typeof(AdminPropertyUsersController))]
    public void ResolveEndpoint_UsesCandidateSpecificRateLimit(Type controllerType)
    {
        var method = controllerType.GetMethod("ResolveCandidate");
        var attribute = Assert.Single(
            method!.GetCustomAttributes<EnableRateLimitingAttribute>());

        Assert.Equal(PropertyUserResolveRateLimitPolicy.Name, attribute.PolicyName);
    }

    [Fact]
    public async Task CandidateRateLimit_RejectsRepeatedAttempts_AcrossProperties_AndIsolatesActors()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(
            PropertyUserResolveRateLimitPolicy.CreatePartition);
        var firstPropertyContext = CreateResolveHttpContext(OwnerUserId, FirstPropertyId);

        var acceptedLeases = new List<RateLimitLease>();
        for (var attempt = 0; attempt < PropertyUserResolveRateLimitPolicy.PermitLimit; attempt++)
        {
            var lease = await limiter.AcquireAsync(firstPropertyContext);
            acceptedLeases.Add(lease);
            Assert.True(lease.IsAcquired);
        }

        using var rejectedLease = await limiter.AcquireAsync(firstPropertyContext);
        Assert.False(rejectedLease.IsAcquired);

        using var sameActorOtherPropertyLease = await limiter.AcquireAsync(
            CreateResolveHttpContext(OwnerUserId, SecondPropertyId));
        Assert.False(sameActorOtherPropertyLease.IsAcquired);

        using var otherActorLease = await limiter.AcquireAsync(
            CreateResolveHttpContext(OtherOwnerUserId, SecondPropertyId));
        Assert.True(otherActorLease.IsAcquired);

        acceptedLeases.ForEach(lease => lease.Dispose());
    }

    [Fact]
    public async Task ExistingPlatformUser_CanJoinMultipleProperties_WithoutIdentityMutation()
    {
        await using var database = await TestDatabase.CreateAsync();
        var platformUser = CreateUser(
            ExistingUserId,
            UserRole.SuperAdmin,
            "platform-user",
            "09124444444");
        database.Context.Users.Add(platformUser);
        database.Context.UserPropertyAccesses.Add(CreateMembership(
            ExistingUserId,
            SecondPropertyId,
            PropertyUserRole.Accounting,
            PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Accounting)));
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        await service.CreateUserAsync(
            OwnerUserId,
            UserRole.Client,
            FirstPropertyId,
            new PropertyUserRequest
            {
                Mobile = "+989124444444",
                FullName = "Should Be Ignored",
                Email = "ignored@example.test",
                Role = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Active,
                IsActive = true
            });

        await database.Context.Entry(platformUser).ReloadAsync();
        var memberships = await database.Context.UserPropertyAccesses
            .Where(access => access.UserId == ExistingUserId)
            .OrderBy(access => access.PropertyId)
            .ToListAsync();
        Assert.Equal(UserRole.SuperAdmin, platformUser.Role);
        Assert.Equal("platform-user@example.test", platformUser.Email);
        Assert.Equal([FirstPropertyId, SecondPropertyId], memberships.Select(item => item.PropertyId));
    }

    [Fact]
    public async Task NewUserAndMembership_AreCreatedTogether_WithRoleDefaultMatrix()
    {
        await using var database = await TestDatabase.CreateAsync();
        var service = CreateService(database.Context);

        var created = await service.CreateUserAsync(
            OwnerUserId,
            UserRole.Client,
            FirstPropertyId,
            new PropertyUserRequest
            {
                FullName = "New Member",
                Mobile = "09125555555",
                Email = null,
                Role = PropertyUserRole.Reception,
                Status = PropertyUserStatus.Pending,
                IsActive = false
            });

        var user = await database.Context.Users.SingleAsync(item => item.Id == created.UserId);
        var membership = await database.Context.UserPropertyAccesses.SingleAsync(
            access => access.UserId == created.UserId && access.PropertyId == FirstPropertyId);
        var stored = JsonSerializer.Deserialize<PermissionMatrixDto>(membership.PermissionMatrixJson)!;
        var defaults = PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Reception);
        Assert.Equal(UserRole.Client, user.Role);
        Assert.Equal("09125555555", user.PhoneNumber);
        Assert.Equal(defaults["Bookings"].View, stored["Bookings"].View);
        Assert.Equal(defaults["Users"].Edit, stored["Users"].Edit);
    }

    [Fact]
    public async Task CustomPermissionMatrix_IsPreserved()
    {
        await using var database = await TestDatabase.CreateAsync();
        var service = CreateService(database.Context);
        var custom = PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Manager);
        custom["Bookings"].Edit = false;
        custom["Reports"].Export = true;

        var created = await service.CreateUserAsync(
            OwnerUserId,
            UserRole.Client,
            FirstPropertyId,
            new PropertyUserRequest
            {
                FullName = "Custom Member",
                Mobile = "09126666666",
                Role = PropertyUserRole.Manager,
                Status = PropertyUserStatus.Active,
                IsActive = true,
                Permissions = custom
            });

        var membership = await database.Context.UserPropertyAccesses.SingleAsync(
            access => access.UserId == created.UserId);
        var stored = JsonSerializer.Deserialize<PermissionMatrixDto>(membership.PermissionMatrixJson)!;
        Assert.False(stored["Bookings"].Edit);
        Assert.True(stored["Reports"].Export);
    }

    [Fact]
    public async Task DuplicateMembership_IsReportedWithoutAccountDetails()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Context.Users.Add(CreateUser(ExistingUserId, UserRole.Client, "existing", "09127777777"));
        database.Context.UserPropertyAccesses.Add(CreateMembership(
            ExistingUserId,
            FirstPropertyId,
            PropertyUserRole.Manager,
            PropertyPermissionMatrixDefaults.CreateForRole(PropertyUserRole.Manager)));
        await database.Context.SaveChangesAsync();
        var service = CreateService(database.Context);

        var lookup = await service.ResolveCandidateAsync(
            OwnerUserId,
            FirstPropertyId,
            new PropertyUserCandidateRequest { Mobile = "09127777777" });
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateUserAsync(
                OwnerUserId,
                UserRole.Client,
                FirstPropertyId,
                new PropertyUserRequest
                {
                    Mobile = "09127777777",
                    Role = PropertyUserRole.Manager
                }));

        Assert.Equal(PropertyUserCandidateOutcome.AlreadyMember, lookup.Outcome);
        Assert.Null(lookup.MaskedName);
        Assert.Equal("این کاربر قبلاً عضو این اقامتگاه است.", exception.Message);
    }

    [Fact]
    public async Task UserCreation_RollsBack_WhenInvitationCreationFails()
    {
        await using var database = await TestDatabase.CreateAsync();
        var service = CreateService(database.Context, new ThrowingAuthService());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateUserAsync(
                OwnerUserId,
                UserRole.Client,
                FirstPropertyId,
                new PropertyUserRequest
                {
                    FullName = "Rollback Member",
                    Mobile = "09128888888",
                    Role = PropertyUserRole.Manager,
                    Status = PropertyUserStatus.Pending,
                    IsActive = false
                }));

        database.Context.ChangeTracker.Clear();
        Assert.False(await database.Context.Users.AnyAsync(user => user.PhoneNumber == "09128888888"));
        Assert.False(await database.Context.UserPropertyAccesses.AnyAsync(
            access => access.PropertyId == FirstPropertyId &&
                      access.User.PhoneNumber == "09128888888"));
    }

    private static PropertyUserService CreateService(
        KoochDbContext context,
        IAuthService? authService = null)
    {
        var authorization = new PropertyAccessService(context);
        return new PropertyUserService(
            context,
            authorization,
            authService ?? new StubAuthService(),
            new TestHostEnvironment());
    }

    private static User CreateUser(
        int id,
        UserRole role,
        string identifier,
        string phone,
        bool isDeleted = false) => new()
    {
        Id = id,
        FirstName = identifier.Split('-')[0],
        LastName = "user",
        Email = $"{identifier}@example.test",
        PhoneNumber = phone,
        Username = identifier,
        PasswordHash = "not-used",
        Role = role,
        IsActive = true,
        IsDeleted = isDeleted
    };

    private static UserPropertyAccess CreateMembership(
        int userId,
        int propertyId,
        PropertyUserRole role,
        PermissionMatrixDto matrix) => new()
    {
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = role,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = JsonSerializer.Serialize(matrix)
    };

    private static DefaultHttpContext CreateResolveHttpContext(int actorUserId, int propertyId)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, actorUserId.ToString())],
                "test"))
        };
        context.Request.RouteValues["propertyId"] = propertyId;
        context.Request.Path = $"/api/owner/properties/{propertyId}/users/resolve";
        return context;
    }

    private sealed class TestDatabase : IAsyncDisposable
    {
        private TestDatabase(SqliteConnection connection, KoochDbContext context)
        {
            Connection = connection;
            Context = context;
        }

        public SqliteConnection Connection { get; }
        public KoochDbContext Context { get; }

        public static async Task<TestDatabase> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            var context = new KoochDbContext(options);
            await context.Database.EnsureCreatedAsync();

            context.Users.AddRange(
                CreateUser(OwnerUserId, UserRole.Client, "owner", "09120000001"),
                CreateUser(OtherOwnerUserId, UserRole.Client, "other-owner", "09120000002"));
            context.Destinations.Add(new Destination
            {
                Id = DestinationId,
                Name = "Kashan",
                Slug = "kashan",
                Country = "Iran"
            });
            context.Properties.AddRange(
                CreateProperty(FirstPropertyId, OwnerUserId, "first-property"),
                CreateProperty(SecondPropertyId, OtherOwnerUserId, "second-property"));
            context.UserPropertyAccesses.AddRange(
                CreateMembership(
                    OwnerUserId,
                    FirstPropertyId,
                    PropertyUserRole.PropertyOwner,
                    PropertyPermissionMatrixDefaults.CreateOwner()),
                CreateMembership(
                    OtherOwnerUserId,
                    SecondPropertyId,
                    PropertyUserRole.PropertyOwner,
                    PropertyPermissionMatrixDefaults.CreateOwner()));
            await context.SaveChangesAsync();
            return new TestDatabase(connection, context);
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await Connection.DisposeAsync();
        }

        private static Property CreateProperty(int id, int ownerId, string slug) => new()
        {
            Id = id,
            OwnerId = ownerId,
            DestinationId = DestinationId,
            Name = slug,
            Slug = slug,
            Description = slug,
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        };
    }

    private class StubAuthService : IAuthService
    {
        public virtual Task<string> CreatePasswordSetupTokenAsync(
            int userId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult($"setup-{userId}");

        public string GenerateJwtToken(User user, DateTime expiresAtUtc) => string.Empty;
        public Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default) => Task.FromResult<CurrentUserResponse?>(null);
        public Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default) => Task.FromResult<AuthResponse?>(null);
        public Task<RequestOtpResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<RequestOtpResponse> RequestOtpAsync(RequestOtpRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task SetPasswordAsync(SetPasswordRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(string token, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<AuthResponse?> VerifyOtpAsync(VerifyOtpRequest request, CancellationToken cancellationToken = default) => Task.FromResult<AuthResponse?>(null);
    }

    private sealed class ThrowingAuthService : StubAuthService
    {
        public override Task<string> CreatePasswordSetupTokenAsync(
            int userId,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Invitation failed.");
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private const int OwnerUserId = 1;
    private const int OtherOwnerUserId = 2;
    private const int ExistingUserId = 10;
    private const int DeletedUserId = 11;
    private const int DestinationId = 20;
    private const int FirstPropertyId = 100;
    private const int SecondPropertyId = 200;
}
