using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class TransferOwnershipHardeningTests
{
    [Theory]
    [InlineData(UserRole.OwnerAssistant)]
    [InlineData(UserRole.AdminAssistant)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task ExistingActiveUser_CanOwnWithoutChangingPlatformRole(UserRole targetRole)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, targetRole);

        var result = await TransferAsync(database.Context, CandidateId);

        Assert.Equal(CandidateId, result.OwnerId);
        Assert.Equal(targetRole, (await database.Context.Users.SingleAsync(user => user.Id == CandidateId)).Role);
        await AssertCanonicalOwnerAsync(database.Context, CandidateId);
    }

    [Fact]
    public async Task ExistingMembership_IsRestoredAndPromotedWithoutDuplication()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.AdminAssistant);
        database.Context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = CandidateId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.Reception,
            Status = PropertyUserStatus.Inactive,
            IsActive = false,
            IsDeleted = true,
            DeletedAtUtc = DateTime.UtcNow,
            PermissionMatrixJson = "{}"
        });
        await database.Context.SaveChangesAsync();

        await TransferAsync(database.Context, CandidateId);

        var accesses = await database.Context.UserPropertyAccesses.IgnoreQueryFilters()
            .Where(access => access.PropertyId == PropertyId && access.UserId == CandidateId)
            .ToListAsync();
        var promoted = Assert.Single(accesses);
        Assert.False(promoted.IsDeleted);
        Assert.True(promoted.IsActive);
        Assert.Equal(PropertyUserStatus.Active, promoted.Status);
        Assert.Equal(PropertyUserRole.PropertyOwner, promoted.PropertyRole);
        var permissions = JsonSerializer.Deserialize<PermissionMatrixDto>(promoted.PermissionMatrixJson)!;
        Assert.True(permissions["Users"].Create);
        Assert.True(permissions["Settings"].Delete);
    }

    [Fact]
    public async Task CandidateMembershipAtAnotherProperty_IsPreserved()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.OwnerAssistant);
        database.Context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = CandidateId,
            PropertyId = OtherPropertyId,
            PropertyRole = PropertyUserRole.Manager,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = "{}"
        });
        await database.Context.SaveChangesAsync();

        await TransferAsync(database.Context, CandidateId);

        var otherAccess = await database.Context.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == OtherPropertyId && access.UserId == CandidateId);
        Assert.Equal(PropertyUserRole.Manager, otherAccess.PropertyRole);
        Assert.True(otherAccess.IsActive);
        await AssertCanonicalOwnerAsync(database.Context, CandidateId);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public async Task InactiveOrDeletedCandidate_IsRejected(bool isActive, bool isDeleted)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);
        var candidate = await database.Context.Users.SingleAsync(user => user.Id == CandidateId);
        candidate.IsActive = isActive;
        candidate.IsDeleted = isDeleted;
        await database.Context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => TransferAsync(database.Context, CandidateId));
        await AssertCanonicalOwnerAsync(database.Context, CurrentOwnerId);
    }

    [Fact]
    public async Task CurrentOwnerAndConflictingOwnerMembership_AreRejected()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            TransferAsync(database.Context, CurrentOwnerId));

        database.Context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = ConflictingOwnerId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.PropertyOwner,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = "{}"
        });
        await database.Context.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            TransferAsync(database.Context, CandidateId));
        var property = await database.Context.Properties.SingleAsync(property => property.Id == PropertyId);
        Assert.Equal(CurrentOwnerId, property.OwnerId);
    }

    [Theory]
    [InlineData(99, null)]
    [InlineData(0, 1)]
    [InlineData(1, null)]
    [InlineData(1, 0)]
    [InlineData(1, 99)]
    public async Task InvalidPreviousOwnerEnums_AreRejectedBeforeMutation(int action, int? role)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);
        var request = new AdminTransferPropertyOwnershipRequest
        {
            NewOwnerId = CandidateId,
            PreviousOwnerAction = (PreviousOwnerTransferAction)action,
            PreviousOwnerRole = role.HasValue ? (PropertyUserRole)role.Value : null
        };

        await Assert.ThrowsAsync<ArgumentException>(() => CreateService(database.Context)
            .TransferOwnershipAsync(AdminId, UserRole.SuperAdmin, PropertyId, request));
        await AssertCanonicalOwnerAsync(database.Context, CurrentOwnerId);
    }

    [Fact]
    public async Task Demote_RestoresSoftDeletedPreviousMembershipAndAppliesRoleDefaults()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);
        var previous = await database.Context.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == PropertyId && access.UserId == CurrentOwnerId);
        previous.IsDeleted = true;
        previous.DeletedAtUtc = DateTime.UtcNow;
        await database.Context.SaveChangesAsync();

        await TransferAsync(
            database.Context,
            CandidateId,
            PreviousOwnerTransferAction.Demote,
            PropertyUserRole.Reception);

        var restored = await database.Context.UserPropertyAccesses.IgnoreQueryFilters().SingleAsync(access =>
            access.PropertyId == PropertyId && access.UserId == CurrentOwnerId);
        Assert.False(restored.IsDeleted);
        Assert.True(restored.IsActive);
        Assert.Equal(PropertyUserRole.Reception, restored.PropertyRole);
        var permissions = JsonSerializer.Deserialize<PermissionMatrixDto>(restored.PermissionMatrixJson)!;
        Assert.True(permissions["Bookings"].Create);
        Assert.False(permissions["Settings"].View);
    }

    [Fact]
    public async Task Demote_CreatesMissingPreviousMembership_WhileDeactivateDoesNot()
    {
        await using var demoteDatabase = await TestDatabase.CreateAsync();
        await SeedAsync(demoteDatabase.Context, UserRole.Client, includeOwnerMembership: false);
        await TransferAsync(
            demoteDatabase.Context,
            CandidateId,
            PreviousOwnerTransferAction.Demote,
            PropertyUserRole.Manager);
        Assert.True(await demoteDatabase.Context.UserPropertyAccesses.AnyAsync(access =>
            access.PropertyId == PropertyId &&
            access.UserId == CurrentOwnerId &&
            access.PropertyRole == PropertyUserRole.Manager));

        await using var deactivateDatabase = await TestDatabase.CreateAsync();
        await SeedAsync(deactivateDatabase.Context, UserRole.Client, includeOwnerMembership: false);
        await TransferAsync(deactivateDatabase.Context, CandidateId);
        Assert.False(await deactivateDatabase.Context.UserPropertyAccesses.AnyAsync(access =>
            access.PropertyId == PropertyId && access.UserId == CurrentOwnerId));
    }

    [Theory]
    [InlineData("۰۹۱۲۱۲۳۴۵۶۷", "candidate-new@example.test")]
    [InlineData("09129999999", " CANDIDATE@EXAMPLE.TEST ")]
    public async Task NewOwner_NormalizedDuplicateIdentityIsRejected(string phone, string? email)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);
        var request = new AdminTransferPropertyOwnershipRequest
        {
            NewOwner = new AdminPropertyOwnerAccountRequest
            {
                FirstName = "Duplicate",
                LastName = "Identity",
                PhoneNumber = phone,
                Email = email,
                Password = "password1"
            },
            PreviousOwnerAction = PreviousOwnerTransferAction.DeactivateMembership
        };

        await Assert.ThrowsAsync<ArgumentException>(() => CreateService(database.Context)
            .TransferOwnershipAsync(AdminId, UserRole.SuperAdmin, PropertyId, request));
        await AssertCanonicalOwnerAsync(database.Context, CurrentOwnerId);
    }

    [Theory]
    [InlineData(ClientId, UserRole.Client)]
    [InlineData(LegacyOwnerId, UserRole.Owner)]
    [InlineData(UnauthorizedAssistantId, UserRole.AdminAssistant)]
    public async Task UnauthorizedActors_CannotTransfer(int actorId, UserRole role)
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            TransferAsync(database.Context, CandidateId, actorId: actorId, actorRole: role));
        await AssertCanonicalOwnerAsync(database.Context, CurrentOwnerId);
    }

    [Fact]
    public async Task AuthorizedAssistantAndSuperAdminCanTransfer_InvalidPropertyIsRejected()
    {
        await using var assistantDatabase = await TestDatabase.CreateAsync();
        await SeedAsync(assistantDatabase.Context, UserRole.Client);
        await TransferAsync(
            assistantDatabase.Context,
            CandidateId,
            actorId: AuthorizedAssistantId,
            actorRole: UserRole.AdminAssistant);
        await AssertCanonicalOwnerAsync(assistantDatabase.Context, CandidateId);

        await using var invalidDatabase = await TestDatabase.CreateAsync();
        await SeedAsync(invalidDatabase.Context, UserRole.Client);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => CreateService(invalidDatabase.Context)
            .TransferOwnershipAsync(
                AdminId,
                UserRole.SuperAdmin,
                999999,
                ValidRequest(CandidateId)));
    }

    [Fact]
    public async Task RelationalFailure_RollsBackNewUserAndAllOwnershipMutations()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.Client);
        await AddFailingAuditTriggerAsync(database.Context);
        var request = new AdminTransferPropertyOwnershipRequest
        {
            NewOwner = new AdminPropertyOwnerAccountRequest
            {
                FirstName = "Rollback",
                LastName = "Created",
                PhoneNumber = "09128888888",
                Email = "rollback-created@example.test",
                Password = "password1"
            },
            PreviousOwnerAction = PreviousOwnerTransferAction.Demote,
            PreviousOwnerRole = PropertyUserRole.Manager
        };

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => CreateService(database.Context)
            .TransferOwnershipAsync(AdminId, UserRole.SuperAdmin, PropertyId, request));

        await using var verification = database.CreateContext();
        await AssertCanonicalOwnerAsync(verification, CurrentOwnerId);
        Assert.False(await verification.Users.AnyAsync(user => user.Email == "rollback-created@example.test"));
        Assert.Empty(await verification.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task RelationalFailure_RollsBackExistingMembershipPromotionAndPreviousOwnerMutation()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.AdminAssistant);
        database.Context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = CandidateId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.Housekeeping,
            Status = PropertyUserStatus.Inactive,
            IsActive = false,
            PermissionMatrixJson = "{\"before\":{}}"
        });
        await database.Context.SaveChangesAsync();
        await AddFailingAuditTriggerAsync(database.Context);

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TransferAsync(
            database.Context,
            CandidateId,
            PreviousOwnerTransferAction.DeactivateMembership));

        await using var verification = database.CreateContext();
        await AssertCanonicalOwnerAsync(verification, CurrentOwnerId);
        var candidateAccess = await verification.UserPropertyAccesses.SingleAsync(access =>
            access.PropertyId == PropertyId && access.UserId == CandidateId);
        Assert.Equal(PropertyUserRole.Housekeeping, candidateAccess.PropertyRole);
        Assert.Equal(PropertyUserStatus.Inactive, candidateAccess.Status);
        Assert.False(candidateAccess.IsActive);
        Assert.Equal("{\"before\":{}}", candidateAccess.PermissionMatrixJson);
        Assert.Empty(await verification.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task CandidateSearch_IsBoundedDeterministicRoleIndependentAndNarrow()
    {
        await using var database = await TestDatabase.CreateAsync();
        await SeedAsync(database.Context, UserRole.AdminAssistant);
        var inactive = await database.Context.Users.SingleAsync(user => user.Id == InactiveId);
        inactive.FirstName = "Candidate";
        var deleted = await database.Context.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == DeletedId);
        deleted.FirstName = "Candidate";
        await database.Context.SaveChangesAsync();
        var service = CreateOwnerAccountService(database.Context);

        var page = await service.SearchCandidatesAsync(
            AdminId,
            UserRole.SuperAdmin,
            new AdminPropertyOwnerCandidateQuery
            {
                Search = "Candidate",
                Page = 1,
                PageSize = 1,
                ExcludeUserId = CurrentOwnerId
            });

        Assert.Single(page.Items);
        Assert.Equal(CandidateId, page.Items[0].Id);
        Assert.Equal(1, page.PageSize);
        Assert.DoesNotContain(
            typeof(AdminPropertyOwnerCandidateResponse).GetProperties(),
            property => property.Name is "Role" or "PasswordSetupRequired" or "UserPropertyAccesses");
    }

    private static AdminTransferPropertyOwnershipRequest ValidRequest(
        int candidateId,
        PreviousOwnerTransferAction action = PreviousOwnerTransferAction.DeactivateMembership,
        PropertyUserRole? role = null) => new()
    {
        NewOwnerId = candidateId,
        PreviousOwnerAction = action,
        PreviousOwnerRole = role
    };

    private static Task<PropertyResponse> TransferAsync(
        KoochDbContext context,
        int candidateId,
        PreviousOwnerTransferAction action = PreviousOwnerTransferAction.DeactivateMembership,
        PropertyUserRole? previousRole = null,
        int actorId = AdminId,
        UserRole actorRole = UserRole.SuperAdmin) =>
        CreateService(context).TransferOwnershipAsync(
            actorId,
            actorRole,
            PropertyId,
            ValidRequest(candidateId, action, previousRole));

    private static async Task AssertCanonicalOwnerAsync(KoochDbContext context, int expectedOwnerId)
    {
        context.ChangeTracker.Clear();
        var property = await context.Properties.SingleAsync(property => property.Id == PropertyId);
        var owners = await context.UserPropertyAccesses
            .Where(access =>
                access.PropertyId == PropertyId &&
                access.PropertyRole == PropertyUserRole.PropertyOwner &&
                access.Status == PropertyUserStatus.Active &&
                access.IsActive)
            .ToListAsync();
        Assert.Equal(expectedOwnerId, property.OwnerId);
        Assert.Equal(expectedOwnerId, Assert.Single(owners).UserId);
    }

    private static async Task AddFailingAuditTriggerAsync(KoochDbContext context) =>
        await context.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER FailTransferAudit
            BEFORE INSERT ON AuditLogs
            BEGIN
                SELECT RAISE(ABORT, 'transfer audit failed');
            END;
            """);

    private static PropertyService CreateService(KoochDbContext context)
    {
        var authorization = new PropertyAccessService(context);
        return new PropertyService(
            context,
            authorization,
            authorization,
            new PermissionService(context, authorization),
            null!,
            null!);
    }

    private static AdminPropertyOwnerAccountService CreateOwnerAccountService(KoochDbContext context)
    {
        var authorization = new PropertyAccessService(context);
        return new AdminPropertyOwnerAccountService(
            context,
            new PermissionService(context, authorization),
            null!,
            null!);
    }

    private static async Task SeedAsync(
        KoochDbContext context,
        UserRole candidateRole,
        bool includeOwnerMembership = true)
    {
        context.Users.AddRange(
            User(AdminId, UserRole.SuperAdmin, "Admin", "Root", "09120000001"),
            User(CurrentOwnerId, UserRole.Client, "Current", "Owner", "09120000002"),
            User(CandidateId, candidateRole, "Candidate", "Target", "09121234567", "candidate@example.test"),
            User(ConflictingOwnerId, UserRole.Client, "Conflict", "Owner", "09120000004"),
            User(AuthorizedAssistantId, UserRole.AdminAssistant, "Allowed", "Assistant", "09120000005"),
            User(UnauthorizedAssistantId, UserRole.AdminAssistant, "Denied", "Assistant", "09120000006"),
            User(ClientId, UserRole.Client, "Ordinary", "User", "09120000007"),
            User(LegacyOwnerId, UserRole.Owner, "Legacy", "Owner", "09120000008"),
            User(InactiveId, UserRole.Client, "Inactive", "User", "09120000009", isActive: false),
            User(DeletedId, UserRole.Client, "Deleted", "User", "09120000010", isDeleted: true));
        context.Permissions.Add(new Permission
        {
            Key = PermissionKey.ManageProperties,
            Name = nameof(PermissionKey.ManageProperties)
        });
        context.UserPermissions.Add(new UserPermission
        {
            UserId = AuthorizedAssistantId,
            PermissionKey = PermissionKey.ManageProperties,
            IsAllowed = true
        });
        context.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        context.Properties.AddRange(
            Property(PropertyId, CurrentOwnerId, "transfer-property"),
            Property(OtherPropertyId, ConflictingOwnerId, "other-property"));
        if (includeOwnerMembership)
        {
            context.UserPropertyAccesses.Add(Access(
                CurrentOwnerId,
                PropertyId,
                PropertyUserRole.PropertyOwner));
        }
        context.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = AuthorizedAssistantId,
            PropertyId = PropertyId,
            PropertyRole = PropertyUserRole.Manager,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
            {
                ["Properties"] = new PermissionActionsDto
                {
                    View = true,
                    Edit = true
                }
            })
        });
        context.UserPropertyAccesses.Add(Access(
            ConflictingOwnerId,
            OtherPropertyId,
            PropertyUserRole.PropertyOwner));
        await context.SaveChangesAsync();
    }

    private static User User(
        int id,
        UserRole role,
        string firstName,
        string lastName,
        string phone,
        string? email = null,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        Id = id,
        FirstName = firstName,
        LastName = lastName,
        PhoneNumber = phone,
        Email = email ?? $"user-{id}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive,
        IsDeleted = isDeleted
    };

    private static Property Property(int id, int ownerId, string slug) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = DestinationId,
        Name = slug,
        Slug = slug,
        Description = "Test property",
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private static UserPropertyAccess Access(
        int userId,
        int propertyId,
        PropertyUserRole role) => new()
    {
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = role,
        Status = PropertyUserStatus.Active,
        IsActive = true,
        PermissionMatrixJson = "{}"
    };

    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        public KoochDbContext Context { get; private set; } = null!;

        private TestDatabase()
        {
        }

        public static async Task<TestDatabase> CreateAsync()
        {
            var database = new TestDatabase();
            await database.connection.OpenAsync();
            database.Context = database.CreateContext();
            await database.Context.Database.EnsureCreatedAsync();
            return database;
        }

        public KoochDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options);

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private const int AdminId = 1;
    private const int CurrentOwnerId = 2;
    private const int CandidateId = 3;
    private const int ConflictingOwnerId = 4;
    private const int AuthorizedAssistantId = 5;
    private const int UnauthorizedAssistantId = 6;
    private const int ClientId = 7;
    private const int LegacyOwnerId = 8;
    private const int InactiveId = 9;
    private const int DeletedId = 10;
    private const int DestinationId = 20;
    private const int PropertyId = 100;
    private const int OtherPropertyId = 101;
}
