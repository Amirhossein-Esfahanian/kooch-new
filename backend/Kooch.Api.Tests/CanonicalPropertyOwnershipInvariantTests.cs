using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CanonicalPropertyOwnershipInvariantTests
{
    [Fact]
    public async Task PropertyCreation_CreatesExactlyOneActiveCanonicalOwnerMembership()
    {
        await using var database = await CreateDatabaseAsync();
        await using var dbContext = database.CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreatePropertyService(dbContext);

        var created = await service.CreatePropertyAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            CreatePropertyRequest(OwnerUserId, "Canonical success property"));

        var property = await dbContext.Properties.SingleAsync(item => item.Id == created.Id);
        var ownerMemberships = await ActiveOwnerMemberships(dbContext, property.Id).ToListAsync();

        Assert.Equal(OwnerUserId, property.OwnerId);
        Assert.Single(ownerMemberships);
        Assert.Equal(property.OwnerId, ownerMemberships[0].UserId);
    }

    [Fact]
    public async Task PropertyCreation_RollsBackPropertyIfOwnerMembershipCreationFails()
    {
        await using var database = await CreateDatabaseAsync();
        await using var dbContext = database.CreateContext();
        await SeedBaseAsync(dbContext);
        await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER FailOwnerMembershipInsert
            BEFORE INSERT ON UserPropertyAccesses
            WHEN NEW.PropertyRole = 0
            BEGIN
                SELECT RAISE(ABORT, 'owner membership insert failed');
            END;
            """);
        var service = CreatePropertyService(dbContext);

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => service.CreatePropertyAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            CreatePropertyRequest(OwnerUserId, "Rollback property")));

        await using var verificationContext = database.CreateContext();
        Assert.False(await verificationContext.Properties.AnyAsync(property => property.Name == "Rollback property"));
        Assert.Empty(await verificationContext.UserPropertyAccesses.ToListAsync());
    }

    [Fact]
    public async Task PropertyCreation_RejectsInactiveOwnerAccount()
    {
        await using var database = await CreateDatabaseAsync();
        await using var dbContext = database.CreateContext();
        await SeedBaseAsync(dbContext);
        dbContext.Users.Add(CreateUser(InactiveOwnerUserId, UserRole.Client, "inactive-owner", false));
        await dbContext.SaveChangesAsync();
        var service = CreatePropertyService(dbContext);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreatePropertyAsync(
            AdminUserId,
            UserRole.SuperAdmin,
            CreatePropertyRequest(InactiveOwnerUserId, "Inactive owner property")));

        Assert.False(await dbContext.Properties.AnyAsync(property => property.Name == "Inactive owner property"));
    }

    [Fact]
    public async Task SeededProperties_SatisfyCanonicalClientOwnerMembershipInvariant()
    {
        await using var database = await CreateDatabaseAsync();
        await using var dbContext = database.CreateContext();
        await SeedExistingDemoPropertiesAsync(dbContext);

        await SeedData.InitializeAsync(dbContext);

        await AssertSeededDemoPropertiesUseCanonicalClientOwnerAsync(dbContext);
    }

    [Fact]
    public async Task SeededProperties_RepairIsIdempotent()
    {
        await using var database = await CreateDatabaseAsync();
        await using var dbContext = database.CreateContext();
        await SeedExistingDemoPropertiesAsync(dbContext);

        await SeedData.InitializeAsync(dbContext);
        var ownerCountAfterFirstRun = await dbContext.Users.IgnoreQueryFilters()
            .CountAsync(user => user.Email == DemoOwnerEmail);
        var membershipCountAfterFirstRun = await dbContext.UserPropertyAccesses.IgnoreQueryFilters().CountAsync();

        await SeedData.InitializeAsync(dbContext);

        Assert.Equal(ownerCountAfterFirstRun, await dbContext.Users.IgnoreQueryFilters()
            .CountAsync(user => user.Email == DemoOwnerEmail));
        Assert.Equal(membershipCountAfterFirstRun, await dbContext.UserPropertyAccesses.IgnoreQueryFilters().CountAsync());
        await AssertSeededDemoPropertiesUseCanonicalClientOwnerAsync(dbContext);
    }

    private static async Task AssertSeededDemoPropertiesUseCanonicalClientOwnerAsync(KoochDbContext dbContext)
    {
        var seededProperties = await dbContext.Properties
            .Include(property => property.Owner)
            .Where(property => property.Slug == "kashan-courtyard-house" || property.Slug == "fin-garden-boutique-stay")
            .OrderBy(property => property.Slug)
            .ToListAsync();

        Assert.Equal(2, seededProperties.Count);
        foreach (var property in seededProperties)
        {
            Assert.Equal(UserRole.Client, property.Owner.Role);
            Assert.True(property.Owner.IsActive);
            Assert.False(property.Owner.IsDeleted);

            var ownerMemberships = await ActiveOwnerMemberships(dbContext, property.Id).ToListAsync();
            var ownerMembership = Assert.Single(ownerMemberships);
            Assert.Equal(property.OwnerId, ownerMembership.UserId);
        }
    }
    private static IQueryable<UserPropertyAccess> ActiveOwnerMemberships(KoochDbContext dbContext, int propertyId) =>
        dbContext.UserPropertyAccesses.Where(access =>
            access.PropertyId == propertyId &&
            access.PropertyRole == PropertyUserRole.PropertyOwner &&
            access.Status == PropertyUserStatus.Active &&
            access.IsActive &&
            !access.IsDeleted);

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

    private static async Task SeedExistingDemoPropertiesAsync(KoochDbContext dbContext)
    {
        dbContext.Users.Add(CreateUser(AdminUserId, UserRole.SuperAdmin, "admin", true, "admin@kooch.local"));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateSeededProperty(100, "Kashan Courtyard House", "kashan-courtyard-house"),
            CreateSeededProperty(101, "Fin Garden Boutique Stay", "fin-garden-boutique-stay"));
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            UserId = AdminUserId,
            PropertyId = 100,
            PropertyRole = PropertyUserRole.Manager,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = "{}"
        });
        await dbContext.SaveChangesAsync();
    }

    private static async Task SeedBaseAsync(KoochDbContext dbContext)
    {
        dbContext.Users.AddRange(
            CreateUser(AdminUserId, UserRole.SuperAdmin, "admin", true),
            CreateUser(OwnerUserId, UserRole.Client, "owner", true));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        await dbContext.SaveChangesAsync();
    }

    private static User CreateUser(int id, UserRole role, string identifier, bool isActive, string? email = null) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = email ?? $"{identifier}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive
    };

    private static Property CreateSeededProperty(int id, string name, string slug) => new()
    {
        Id = id,
        OwnerId = AdminUserId,
        DestinationId = DestinationId,
        Name = name,
        Slug = slug,
        Description = "Seeded property",
        Address = "Seeded address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private static CreatePropertyRequest CreatePropertyRequest(int ownerId, string name) => new()
    {
        OwnerId = ownerId,
        DestinationId = DestinationId,
        Name = name,
        Description = "Test property",
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms
    };

    private static async Task<SqliteTestDatabase> CreateDatabaseAsync()
    {
        var database = new SqliteTestDatabase();
        await using var dbContext = database.CreateContext();
        await dbContext.Database.EnsureCreatedAsync();
        return database;
    }

    private sealed class SqliteTestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public SqliteTestDatabase()
        {
            connection.Open();
        }

        public KoochDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            return new KoochDbContext(options);
        }

        public async ValueTask DisposeAsync()
        {
            await connection.DisposeAsync();
        }
    }

    private const int AdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int InactiveOwnerUserId = 3;
    private const int DestinationId = 10;
    private const string DemoOwnerEmail = "demo-owner@kooch.local";
}