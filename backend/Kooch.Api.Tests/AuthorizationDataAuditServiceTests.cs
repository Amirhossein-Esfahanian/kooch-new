using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AuthorizationDataAuditServiceTests
{
    [Fact]
    public async Task CreateReportAsync_ReportsCanonicalInconsistenciesWithoutChangingData()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var dbContext = new KoochDbContext(options);
        await SeedInconsistentDataAsync(dbContext);
        dbContext.ChangeTracker.Clear();
        var membershipCountBefore = await dbContext.UserPropertyAccesses.CountAsync();
        var service = new AuthorizationDataAuditService(dbContext);

        var report = await service.CreateReportAsync();

        Assert.Equal(9, report.Sections.Count);
        Assert.All(report.Sections, section => Assert.True(section.Count > 0, section.Code));
        Assert.Equal(7, report.Sections.Count(section => !section.IsInformational));
        Assert.Equal(2, report.Sections.Count(section => section.IsInformational));
        Assert.True(report.HasFindings);
        Assert.Contains(report.Sections, section => section.Code == "conflicting-active-property-owner-membership");
        Assert.Contains(report.Sections, section => section.Code == "deleted-owner-membership");
        Assert.DoesNotContain(report.Sections, section => section.Code == "owner-role-property-owner-mismatch");
        Assert.DoesNotContain(report.Sections, section => section.Code == "owner-account-manager-membership");
        Assert.Contains("Read-only report: no data was modified.", report.ToReadableText());
        Assert.Contains("[INFO:", report.ToReadableText());
        Assert.Equal(membershipCountBefore, await dbContext.UserPropertyAccesses.CountAsync());
        Assert.DoesNotContain(
            dbContext.ChangeTracker.Entries(),
            entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted);
    }

    [Fact]
    public async Task CreateReportAsync_TreatsPropertyRolesAsAuthoritativeAndLegacyAssignmentsAsInformation()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var dbContext = new KoochDbContext(options);

        var platformAdmin = CreateUser(1, UserRole.SuperAdmin, true, "platform-admin");
        var clientOwner = CreateUser(2, UserRole.Client, true, "client-owner");
        var legacyAssistant = CreateUser(3, UserRole.OwnerAssistant, true, "legacy-assistant");
        dbContext.Users.AddRange(platformAdmin, clientOwner, legacyAssistant);
        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(10, platformAdmin.Id, 1, "Admin property"),
            CreateProperty(20, clientOwner.Id, 1, "Client property"));
        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(100, platformAdmin.Id, 10, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(101, clientOwner.Id, 20, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(102, legacyAssistant.Id, 10, PropertyUserRole.Manager, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(103, legacyAssistant.Id, 20, PropertyUserRole.Manager, PropertyUserStatus.Active, true, ValidMatrix));
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var report = await new AuthorizationDataAuditService(dbContext).CreateReportAsync();

        Assert.False(report.HasFindings);
        Assert.Equal(0, report.TotalFindings);
        Assert.Equal(2, report.TotalInformationItems);
        Assert.All(
            report.Sections.Where(section => !section.IsInformational),
            section => Assert.Equal(0, section.Count));
        Assert.Single(report.Sections.Single(section => section.Code == "legacy-property-global-role").Items);
        Assert.Single(report.Sections.Single(section => section.Code == "user-with-multiple-properties").Items);
    }

    private static async Task SeedInconsistentDataAsync(KoochDbContext dbContext)
    {
        var owner = CreateUser(1, UserRole.SuperAdmin, true, "owner");
        var legacyOwner = CreateUser(2, UserRole.Owner, true, "legacy-owner");
        var inactiveAssistant = CreateUser(3, UserRole.OwnerAssistant, false, "inactive-assistant");
        var activeClient = CreateUser(4, UserRole.Client, true, "active-client");
        var deletedOwner = CreateUser(5, UserRole.Client, true, "deleted-owner");
        var conflictingOwner = CreateUser(6, UserRole.Client, true, "conflicting-owner");
        dbContext.Users.AddRange(owner, legacyOwner, inactiveAssistant, activeClient, deletedOwner, conflictingOwner);

        var destination = new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        };
        dbContext.Destinations.Add(destination);
        dbContext.Properties.AddRange(
            CreateProperty(10, owner.Id, destination.Id, "Owner property"),
            CreateProperty(20, activeClient.Id, destination.Id, "Other property"),
            CreateProperty(30, deletedOwner.Id, destination.Id, "Deleted owner property"));

        dbContext.UserPropertyAccesses.AddRange(
            CreateMembership(100, owner.Id, 10, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(101, legacyOwner.Id, 10, PropertyUserRole.Manager, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(102, inactiveAssistant.Id, 20, PropertyUserRole.Manager, PropertyUserStatus.Active, true, "{}"),
            CreateMembership(103, inactiveAssistant.Id, 20, PropertyUserRole.Manager, PropertyUserStatus.Active, true, "not-json"),
            CreateMembership(104, inactiveAssistant.Id, 10, PropertyUserRole.Manager, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(105, activeClient.Id, 20, PropertyUserRole.Manager, PropertyUserStatus.Suspended, false, ValidMatrix),
            CreateMembership(106, conflictingOwner.Id, 20, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true, ValidMatrix),
            CreateMembership(107, deletedOwner.Id, 30, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true, ValidMatrix, isDeleted: true));

        await dbContext.SaveChangesAsync();
    }

    private static User CreateUser(
        int id,
        UserRole role,
        bool isActive,
        string identifier) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive
    };

    private static Property CreateProperty(
        int id,
        int ownerId,
        int destinationId,
        string name) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = destinationId,
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

    private static UserPropertyAccess CreateMembership(
        int id,
        int userId,
        int propertyId,
        PropertyUserRole propertyRole,
        PropertyUserStatus status,
        bool isActive,
        string permissionMatrixJson,
        bool isDeleted = false) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = propertyRole,
        Status = status,
        IsActive = isActive,
        IsDeleted = isDeleted,
        PermissionMatrixJson = permissionMatrixJson
    };

    private const string ValidMatrix =
        """
        {
          "Dashboard": {
            "View": true,
            "Create": false,
            "Edit": false,
            "Delete": false,
            "Export": false
          }
        }
        """;
}
