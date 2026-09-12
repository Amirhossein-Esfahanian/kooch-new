using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Utilities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminPropertyMemberDirectoryTests
{
    [Fact]
    public async Task PropertyOptions_SuperAdmin_ReturnsAllNonDeletedProperties()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var result = await CreateService(dbContext).SearchPropertiesAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberPropertyOptionQuery());

        Assert.Equal([101, 102], result.Items.Select(item => item.Id));
        Assert.Equal(2, result.TotalCount);
        Assert.DoesNotContain(result.Items, item => item.Id == 103);
    }

    [Fact]
    public async Task PropertyOptions_AdminAssistant_OnlyReceivesUsersViewProperties()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true);

        var result = await CreateService(dbContext).SearchPropertiesAsync(
            10,
            UserRole.AdminAssistant,
            new AdminPropertyMemberPropertyOptionQuery());

        var property = Assert.Single(result.Items);
        Assert.Equal(101, property.Id);
    }

    [Fact]
    public async Task PropertyOptions_AdminAssistantWithoutManageUsers_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: false);

        var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).SearchPropertiesAsync(
                10,
                UserRole.AdminAssistant,
                new AdminPropertyMemberPropertyOptionQuery()));

        Assert.Equal("ManageUsers permission is required.", exception.Message);
    }

    [Fact]
    public async Task PropertyOptions_ManagePropertiesAlone_GrantsNoAccess()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: false, grantManageProperties: true);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).SearchPropertiesAsync(
                10,
                UserRole.AdminAssistant,
                new AdminPropertyMemberPropertyOptionQuery()));
    }

    [Fact]
    public async Task PropertyOptions_HiddenPropertyNeverLeaksThroughExactSearch()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true);

        var result = await CreateService(dbContext).SearchPropertiesAsync(
            10,
            UserRole.AdminAssistant,
            new AdminPropertyMemberPropertyOptionQuery { Search = "Beta Property" });

        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalCount);
    }

    [Fact]
    public async Task PropertyOptions_SearchTrimsInputAndFiltersByName()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var result = await CreateService(dbContext).SearchPropertiesAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberPropertyOptionQuery { Search = "  Beta  " });

        var property = Assert.Single(result.Items);
        Assert.Equal(102, property.Id);
        Assert.Equal("Beta Property", property.Name);
    }

    [Fact]
    public async Task PropertyOptions_PaginatesWithDeterministicNameThenIdOrdering()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        dbContext.Properties.AddRange(
            Property(104, 2, "Alpha Property"),
            Property(105, 3, "Gamma Property"));
        await dbContext.SaveChangesAsync();
        var service = CreateService(dbContext);

        var firstPage = await service.SearchPropertiesAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberPropertyOptionQuery { Page = 1, PageSize = 2 });
        var secondPage = await service.SearchPropertiesAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberPropertyOptionQuery { Page = 2, PageSize = 2 });

        Assert.Equal([101, 104], firstPage.Items.Select(item => item.Id));
        Assert.Equal([102, 105], secondPage.Items.Select(item => item.Id));
        Assert.Equal(4, firstPage.TotalCount);
        Assert.Equal(2, firstPage.TotalPages);
        Assert.Equal(1, firstPage.Page);
        Assert.Equal(2, firstPage.PageSize);
    }

    [Fact]
    public async Task SuperAdmin_ReturnsOneUserRow_WithAllVisibleMemberships()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var result = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Search = "Multi" });

        var user = Assert.Single(result.Items);
        Assert.Equal(20, user.Id);
        Assert.Equal(2, user.Memberships.Count);
        Assert.Equal([101, 102], user.Memberships.Select(item => item.PropertyId));
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task AdminAssistant_WithManageUsers_OnlyReceivesUsersViewProperties()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true);

        var result = await CreateService(dbContext).SearchAsync(
            10,
            UserRole.AdminAssistant,
            new AdminPropertyMemberDirectoryQuery { Search = "Multi" });

        var user = Assert.Single(result.Items);
        var membership = Assert.Single(user.Memberships);
        Assert.Equal(101, membership.PropertyId);
        Assert.DoesNotContain(user.Memberships, item => item.PropertyId == 102);
    }

    [Fact]
    public async Task AdminAssistant_WithoutManageUsers_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: false);

        var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).SearchAsync(
                10,
                UserRole.AdminAssistant,
                new AdminPropertyMemberDirectoryQuery()));

        Assert.Equal("ManageUsers permission is required.", exception.Message);
    }

    [Fact]
    public async Task AdminAssistant_ManageUsersWithoutUsersView_DoesNotGainPropertyVisibility()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true, grantUsersView: false);

        var result = await CreateService(dbContext).SearchAsync(
            10,
            UserRole.AdminAssistant,
            new AdminPropertyMemberDirectoryQuery());

        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalCount);
    }

    [Fact]
    public async Task FiltersChooseUsers_ButNestedMembershipsRemainUnfiltered()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var service = CreateService(dbContext);

        var propertyResult = await service.SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { PropertyId = 101, Search = "Multi" });
        var roleResult = await service.SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Role = PropertyUserRole.Reception, Search = "Multi" });
        var statusResult = await service.SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Status = PropertyUserStatus.Suspended, Search = "Multi" });

        Assert.Equal(2, Assert.Single(propertyResult.Items).Memberships.Count);
        Assert.Equal(2, Assert.Single(roleResult.Items).Memberships.Count);
        Assert.Equal(2, Assert.Single(statusResult.Items).Memberships.Count);
    }

    [Theory]
    [InlineData("Multi")]
    [InlineData("Member")]
    [InlineData("09121110020")]
    [InlineData("multi@example.test")]
    public async Task Search_MatchesSupportedUserFields(string search)
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var result = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Search = $"  {search}  " });

        Assert.Equal(20, Assert.Single(result.Items).Id);
    }

    [Fact]
    public async Task Pagination_IsUserBased_Deterministic_AndReportsDistinctTotal()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var firstPage = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Page = 1, PageSize = 2 });
        var secondPage = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Page = 2, PageSize = 2 });

        Assert.Equal(5, firstPage.TotalCount);
        Assert.Equal(3, firstPage.TotalPages);
        Assert.Equal([21, 10], firstPage.Items.Select(item => item.Id));
        Assert.Equal([20, 3], secondPage.Items.Select(item => item.Id));
        Assert.DoesNotContain(
            firstPage.Items.Select(item => item.Id),
            id => secondPage.Items.Any(item => item.Id == id));
    }

    [Fact]
    public async Task UserAndMembershipActivityStates_RemainSeparate()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var user = await dbContext.Users.SingleAsync(item => item.Id == 20);
        user.IsActive = false;
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Search = "Multi" });

        var response = Assert.Single(result.Items);
        Assert.False(response.IsActive);
        Assert.True(response.Memberships.Single(item => item.PropertyId == 101).IsActive);
        var suspended = response.Memberships.Single(item => item.PropertyId == 102);
        Assert.Equal(PropertyUserStatus.Suspended, suspended.Status);
        Assert.False(suspended.IsActive);
    }

    [Fact]
    public async Task SoftDeletedUsersPropertiesAndMemberships_AreExcluded()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var result = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery());

        Assert.DoesNotContain(result.Items, item => item.Id is 22 or 23);
        Assert.DoesNotContain(
            result.Items.SelectMany(item => item.Memberships),
            item => item.PropertyId == 103);
    }

    [Fact]
    public async Task CanonicalOwner_ComesFromPropertyOwnerId_WhenOwnerMembershipIsMissing()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var ownerMembership = await dbContext.UserPropertyAccesses.SingleAsync(item => item.Id == 201);
        dbContext.UserPropertyAccesses.Remove(ownerMembership);
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).SearchAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertyMemberDirectoryQuery { Search = "AlphaOwner" });

        var owner = Assert.Single(result.Items);
        var membership = Assert.Single(owner.Memberships);
        Assert.True(membership.IsOwner);
        Assert.Equal(PropertyUserRole.PropertyOwner, membership.Role);
        Assert.Equal(PropertyUserStatus.Inactive, membership.Status);
        Assert.False(membership.IsActive);
    }

    [Fact]
    public async Task UpdateIdentity_SuperAdmin_ChangesOnlyCanonicalIdentity()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var user = await dbContext.Users.SingleAsync(item => item.Id == 20);
        user.SecurityStampVersion = 7;
        var membershipsBefore = await MembershipSnapshotsAsync(dbContext, 20);
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).UpdateIdentityAsync(
            1,
            UserRole.SuperAdmin,
            20,
            IdentityRequest(firstName: "  Updated  ", lastName: "  Member  "));

        Assert.Equal("Updated", result.FirstName);
        Assert.Equal("Member", result.LastName);
        var persisted = await dbContext.Users.IgnoreQueryFilters().SingleAsync(item => item.Id == 20);
        Assert.Equal(7, persisted.SecurityStampVersion);
        Assert.True(persisted.IsActive);
        Assert.Equal(UserRole.Client, persisted.Role);
        Assert.False(persisted.PasswordSetupRequired);
        Assert.Equal(membershipsBefore, await MembershipSnapshotsAsync(dbContext, 20));
        var audit = Assert.Single(await dbContext.AuditLogs.ToListAsync());
        Assert.Equal(AuditAction.PropertyMemberIdentityUpdated, audit.Action);
        Assert.Equal(20, audit.EntityId);
        Assert.Contains(nameof(Kooch.Api.Entities.User.FirstName), audit.Description);
    }

    [Fact]
    public async Task UpdateIdentity_AdminAssistantWithoutManageUsers_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).UpdateIdentityAsync(
                10,
                UserRole.AdminAssistant,
                20,
                IdentityRequest()));
    }

    [Fact]
    public async Task UpdateIdentity_AdminAssistantWithManageUsers_CanEditVisibleGenericUser()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true);

        var result = await CreateService(dbContext).UpdateIdentityAsync(
            10,
            UserRole.AdminAssistant,
            20,
            IdentityRequest(firstName: "Visible"));

        Assert.Equal("Visible", result.FirstName);
    }

    [Fact]
    public async Task UpdateIdentity_TargetOutsideUsersViewVisibility_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext, grantManageUsers: true);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).UpdateIdentityAsync(
                10,
                UserRole.AdminAssistant,
                3,
                IdentityRequest(email: "hidden-owner-updated@example.test")));

        Assert.Equal(
            "beta-owner@example.test",
            (await dbContext.Users.SingleAsync(item => item.Id == 3)).Email);
    }

    [Fact]
    public async Task UpdateIdentity_PlatformAdminTarget_IsRejected()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(dbContext).UpdateIdentityAsync(
                1,
                UserRole.SuperAdmin,
                10,
                IdentityRequest()));

        Assert.Contains("Admin Users", exception.Message);
    }

    [Fact]
    public async Task UpdateIdentity_CanonicalOwner_PreservesOwnershipAndMembership()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var ownerMembershipBefore = await MembershipSnapshotsAsync(dbContext, 2);

        await CreateService(dbContext).UpdateIdentityAsync(
            1,
            UserRole.SuperAdmin,
            2,
            IdentityRequest(
                firstName: "Renamed",
                lastName: "Owner",
                phoneNumber: "09120000002",
                email: "renamed-owner@example.test"));

        Assert.Equal(2, (await dbContext.Properties.SingleAsync(item => item.Id == 101)).OwnerId);
        Assert.Equal(ownerMembershipBefore, await MembershipSnapshotsAsync(dbContext, 2));
    }

    [Theory]
    [InlineData("+98 912 777 8899", "multi@example.test", "09127778899", "multi@example.test", nameof(Kooch.Api.Entities.User.PhoneNumber))]
    [InlineData("09121110020", "  UPDATED@EXAMPLE.TEST  ", "09121110020", "updated@example.test", nameof(Kooch.Api.Entities.User.Email))]
    public async Task UpdateIdentity_ContactChange_NormalizesAndRevokesSessions(
        string phoneNumber,
        string email,
        string expectedPhoneNumber,
        string expectedEmail,
        string expectedChangedField)
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var user = await dbContext.Users.SingleAsync(item => item.Id == 20);
        user.SecurityStampVersion = 4;
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).UpdateIdentityAsync(
            1,
            UserRole.SuperAdmin,
            20,
            IdentityRequest(phoneNumber: phoneNumber, email: email));

        Assert.Equal(expectedPhoneNumber, result.PhoneNumber);
        Assert.Equal(expectedEmail, result.Email);
        Assert.Equal(5, (await dbContext.Users.SingleAsync(item => item.Id == 20)).SecurityStampVersion);
        var audit = Assert.Single(await dbContext.AuditLogs.ToListAsync());
        Assert.Contains(expectedChangedField, audit.Description);
    }

    [Theory]
    [InlineData("09120000021", "unique@example.test", UserIdentityNormalization.DuplicatePhoneNumberMessage)]
    [InlineData("09129998877", "inactive@example.test", UserIdentityNormalization.DuplicateEmailMessage)]
    [InlineData("09120000022", "unique@example.test", UserIdentityNormalization.DuplicatePhoneNumberMessage)]
    [InlineData("09129998877", "deleted@example.test", UserIdentityNormalization.DuplicateEmailMessage)]
    public async Task UpdateIdentity_DuplicateCanonicalIdentity_IsRejected(
        string phoneNumber,
        string email,
        string expectedMessage)
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(dbContext).UpdateIdentityAsync(
                1,
                UserRole.SuperAdmin,
                20,
                IdentityRequest(phoneNumber: phoneNumber, email: email)));

        Assert.Equal(expectedMessage, exception.Message);
        Assert.Empty(await dbContext.AuditLogs.ToListAsync());
    }

    [Theory]
    [InlineData("09123334455", "guest-unique@example.test")]
    [InlineData("09129998877", "guest@example.test")]
    public async Task UpdateIdentity_GuestIdentityConflict_IsRejected(string phoneNumber, string email)
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        dbContext.Guests.Add(new Guest
        {
            FirstName = "Guest",
            LastName = "Identity",
            Mobile = "09123334455",
            NormalizedMobile = "09123334455",
            Email = "guest@example.test",
            NormalizedEmail = "guest@example.test"
        });
        await dbContext.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(dbContext).UpdateIdentityAsync(
                1,
                UserRole.SuperAdmin,
                20,
                IdentityRequest(phoneNumber: phoneNumber, email: email)));

        Assert.Equal("Guest with this mobile or email already exists.", exception.Message);
    }

    [Fact]
    public async Task UpdateIdentity_InactiveUser_RemainsInactive()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var user = await dbContext.Users.SingleAsync(item => item.Id == 20);
        user.IsActive = false;
        await dbContext.SaveChangesAsync();

        await CreateService(dbContext).UpdateIdentityAsync(
            1,
            UserRole.SuperAdmin,
            20,
            IdentityRequest(firstName: "Inactive Updated"));

        Assert.False((await dbContext.Users.SingleAsync(item => item.Id == 20)).IsActive);
    }

    [Fact]
    public async Task UpdateIdentity_AuditPersistenceFailure_RollsBackIdentityAndStamp()
    {
        var interceptor = new AuditPersistenceFailureInterceptor();
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection)
            .AddInterceptors(interceptor)
            .Options;
        await using (var setup = new KoochDbContext(options))
        {
            await setup.Database.EnsureCreatedAsync();
            await SeedAsync(setup);
            var user = await setup.Users.SingleAsync(item => item.Id == 20);
            user.SecurityStampVersion = 9;
            await setup.SaveChangesAsync();
        }

        interceptor.Enabled = true;
        await using (var dbContext = new KoochDbContext(options))
        {
            await Assert.ThrowsAsync<DbUpdateException>(() =>
                CreateService(dbContext).UpdateIdentityAsync(
                    1,
                    UserRole.SuperAdmin,
                    20,
                    IdentityRequest(phoneNumber: "09128889900", email: "rollback@example.test")));
        }

        await using var verification = new KoochDbContext(options);
        var persisted = await verification.Users.SingleAsync(item => item.Id == 20);
        Assert.Equal("Multi", persisted.FirstName);
        Assert.Equal("09121110020", persisted.PhoneNumber);
        Assert.Equal("multi@example.test", persisted.Email);
        Assert.Equal(9, persisted.SecurityStampVersion);
        Assert.Empty(await verification.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task UpdateIdentityController_ReturnsIdentityOnlyContract()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var controller = new AdminPropertyMembersController(CreateService(dbContext));
        SetCurrentUser(controller, 1, UserRole.SuperAdmin);

        var response = await controller.UpdateIdentity(
            20,
            IdentityRequest(firstName: "Controller"),
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var result = Assert.IsType<AdminPropertyMemberIdentityResponse>(ok.Value);

        Assert.Equal(20, result.Id);
        Assert.Equal("Controller", result.FirstName);
    }

    [Fact]
    public async Task Controller_ReturnsSharedPagedResultContract()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var controller = new AdminPropertyMembersController(CreateService(dbContext));
        SetCurrentUser(controller, 1, UserRole.SuperAdmin);

        var response = await controller.Get(
            new AdminPropertyMemberDirectoryQuery { Search = "Multi" },
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var result = Assert.IsType<PagedResult<AdminPropertyMemberDirectoryResponse>>(ok.Value);

        Assert.Equal(20, Assert.Single(result.Items).Id);
    }

    [Fact]
    public async Task PropertyOptionsController_ReturnsSharedPagedResultContract()
    {
        await using var dbContext = CreateContext();
        await SeedAsync(dbContext);
        var controller = new AdminPropertyMembersController(CreateService(dbContext));
        SetCurrentUser(controller, 1, UserRole.SuperAdmin);

        var response = await controller.GetProperties(
            new AdminPropertyMemberPropertyOptionQuery { Page = 1, PageSize = 1 },
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var result = Assert.IsType<PagedResult<AdminPropertyMemberPropertyOptionResponse>>(ok.Value);

        Assert.Single(result.Items);
        Assert.Equal(2, result.TotalCount);
        Assert.Equal(2, result.TotalPages);
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(1, 0)]
    [InlineData(1, 26)]
    public void PropertyOptionQuery_RejectsInvalidPagination(int page, int pageSize)
    {
        var query = new AdminPropertyMemberPropertyOptionQuery { Page = page, PageSize = pageSize };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(
            query,
            new ValidationContext(query),
            results,
            validateAllProperties: true);

        Assert.False(valid);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(1, 0)]
    [InlineData(1, 101)]
    public void Query_RejectsInvalidPagination(int page, int pageSize)
    {
        var query = new AdminPropertyMemberDirectoryQuery { Page = page, PageSize = pageSize };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(
            query,
            new ValidationContext(query),
            results,
            validateAllProperties: true);

        Assert.False(valid);
    }

    private static AdminPropertyMemberDirectoryService CreateService(KoochDbContext dbContext)
    {
        var propertyAccess = new PropertyAccessService(dbContext);
        var permissionService = new PermissionService(dbContext, propertyAccess);
        var auditLogService = new AuditLogService(dbContext, permissionService);
        return new AdminPropertyMemberDirectoryService(
            dbContext,
            propertyAccess,
            permissionService,
            auditLogService);
    }

    private static AdminPropertyMemberIdentityUpdateRequest IdentityRequest(
        string firstName = "Multi",
        string lastName = "Member",
        string phoneNumber = "09121110020",
        string? email = "multi@example.test") => new()
    {
        FirstName = firstName,
        LastName = lastName,
        PhoneNumber = phoneNumber,
        Email = email
    };

    private static async Task<string[]> MembershipSnapshotsAsync(KoochDbContext dbContext, int userId) =>
        await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access => access.UserId == userId)
            .OrderBy(access => access.PropertyId)
            .Select(access => $"{access.PropertyId}|{access.PropertyRole}|{access.Status}|{access.IsActive}|{access.PermissionMatrixJson}")
            .ToArrayAsync();

    private static async Task SeedAsync(
        KoochDbContext dbContext,
        bool grantManageUsers = true,
        bool grantUsersView = true,
        bool grantManageProperties = false)
    {
        dbContext.Users.AddRange(
            User(1, UserRole.SuperAdmin, "Platform", "Admin", "admin@example.test"),
            User(2, UserRole.Client, "AlphaOwner", "Zulu", "alpha-owner@example.test"),
            User(3, UserRole.Client, "BetaOwner", "Owner", "beta-owner@example.test"),
            User(10, UserRole.AdminAssistant, "Assistant", "Actor", "assistant@example.test"),
            User(20, UserRole.Client, "Multi", "Member", "multi@example.test", "09121110020"),
            User(21, UserRole.Client, "Inactive", "Account", "inactive@example.test"),
            User(22, UserRole.Client, "Deleted", "User", "deleted@example.test", isDeleted: true),
            User(23, UserRole.Client, "DeletedMembership", "Only", "deleted-membership@example.test"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Test",
            Slug = "test",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            Property(101, 2, "Alpha Property"),
            Property(102, 3, "Beta Property"),
            Property(103, 3, "Deleted Property", isDeleted: true));
        dbContext.UserPropertyAccesses.AddRange(
            Access(201, 2, 101, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true),
            Access(202, 3, 102, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true),
            Access(210, 10, 101, PropertyUserRole.Manager, PropertyUserStatus.Active, true,
                Matrix(("Users", new PermissionActionsDto { View = grantUsersView }))),
            Access(211, 10, 102, PropertyUserRole.Manager, PropertyUserStatus.Active, true,
                Matrix(("Users", new PermissionActionsDto { View = false }))),
            Access(220, 20, 101, PropertyUserRole.Manager, PropertyUserStatus.Active, true),
            Access(221, 20, 102, PropertyUserRole.Reception, PropertyUserStatus.Suspended, false),
            Access(222, 21, 101, PropertyUserRole.Accounting, PropertyUserStatus.Inactive, true),
            Access(223, 22, 101, PropertyUserRole.Housekeeping, PropertyUserStatus.Active, true),
            Access(224, 23, 101, PropertyUserRole.Custom, PropertyUserStatus.Active, true, isDeleted: true),
            Access(225, 23, 103, PropertyUserRole.Custom, PropertyUserStatus.Active, true));

        if (grantManageUsers)
        {
            dbContext.Permissions.Add(new Permission
            {
                Id = 301,
                Key = PermissionKey.ManageUsers,
                Name = nameof(PermissionKey.ManageUsers)
            });
            dbContext.UserPermissions.Add(new UserPermission
            {
                Id = 302,
                UserId = 10,
                PermissionKey = PermissionKey.ManageUsers,
                IsAllowed = true
            });
        }

        if (grantManageProperties)
        {
            dbContext.Permissions.Add(new Permission
            {
                Id = 303,
                Key = PermissionKey.ManageProperties,
                Name = nameof(PermissionKey.ManageProperties)
            });
            dbContext.UserPermissions.Add(new UserPermission
            {
                Id = 304,
                UserId = 10,
                PermissionKey = PermissionKey.ManageProperties,
                IsAllowed = true
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static User User(
        int id,
        UserRole role,
        string firstName,
        string lastName,
        string email,
        string? phone = null,
        bool isDeleted = false) => new()
    {
        Id = id,
        Role = role,
        FirstName = firstName,
        LastName = lastName,
        Email = email,
        PhoneNumber = phone ?? $"0912000{id:D4}",
        PasswordHash = "not-used",
        IsActive = true,
        IsDeleted = isDeleted,
        DeletedAtUtc = isDeleted ? DateTime.UtcNow : null
    };

    private static Property Property(int id, int ownerId, string name, bool isDeleted = false) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = 1,
        Name = name,
        Slug = name.Replace(' ', '-').ToLowerInvariant(),
        Description = name,
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms,
        IsDeleted = isDeleted,
        DeletedAtUtc = isDeleted ? DateTime.UtcNow : null
    };

    private static UserPropertyAccess Access(
        int id,
        int userId,
        int propertyId,
        PropertyUserRole role,
        PropertyUserStatus status,
        bool isActive,
        string? matrix = null,
        bool isDeleted = false) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = propertyId,
        PropertyRole = role,
        Status = status,
        IsActive = isActive,
        PermissionMatrixJson = matrix ?? Matrix(("Users", new PermissionActionsDto { View = true })),
        IsDeleted = isDeleted,
        DeletedAtUtc = isDeleted ? DateTime.UtcNow : null
    };

    private static string Matrix(params (string Group, PermissionActionsDto Actions)[] values)
    {
        var matrix = new PermissionMatrixDto();
        foreach (var (group, actions) in values)
        {
            matrix[group] = actions;
        }

        return JsonSerializer.Serialize(matrix);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static void SetCurrentUser(ControllerBase controller, int userId, UserRole role)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim(ClaimTypes.Role, role.ToString())
                    ],
                    "AdminPropertyMemberDirectoryTests"))
            }
        };
    }

    private sealed class AuditPersistenceFailureInterceptor : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Enabled && eventData.Context?.ChangeTracker.Entries<AuditLog>()
                    .Any(entry => entry.State == EntityState.Added) == true)
            {
                throw new DbUpdateException("Simulated audit persistence failure.");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }
}
