using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationActivityTests
{
    [Fact]
    public async Task InternalNote_UsesCurrentUserAndReturnsCreatedActivity()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var permissions = new TestPermissions(true);
        var controller = new AdminReservationActivitiesController(new ReservationActivityService(db, permissions))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "20"),
             new Claim(ClaimTypes.Role, UserRole.SuperAdmin.ToString())], "test"));

        var result = await controller.CreateInternalNote(10,
            new CreateReservationInternalNoteRequest { Details = "  Guest called support.  " }, default);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var response = Assert.IsType<ReservationActivityResponse>(created.Value);
        Assert.Equal(10, response.ReservationId);
        Assert.Equal(20, response.ActorUserId);
        Assert.Equal("Ada Lovelace", response.ActorDisplayName);
        Assert.Equal("InternalNote", response.ActivityType);
        Assert.Equal(ReservationActivityVisibility.Internal, response.Visibility);
        Assert.Equal("Guest called support.", response.Details);
        Assert.Null(response.RelatedEntityId);
        Assert.Equal((20, 11, "bookings.edit"), permissions.LastCheck);
        Assert.Equal(PermissionKey.ManageReservations, permissions.LastPlatformPermission);
        Assert.Single(await db.ReservationActivities.ToListAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \t ")]
    public async Task InternalNote_RejectsMissingOrWhitespaceDetails(string? details)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = new ReservationActivityService(db, new TestPermissions(true));

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateInternalNoteAsync(10, 20, details));
        Assert.Empty(db.ReservationActivities);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task InternalNote_RequiresPlatformAndPropertyWritePermission(
        bool platformAllowed, bool propertyAllowed)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var permissions = new TestPermissions(propertyAllowed) { PlatformAllowed = platformAllowed };
        var service = new ReservationActivityService(db, permissions);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.CreateInternalNoteAsync(10, 20, "Private note"));
        Assert.Empty(db.ReservationActivities);
    }

    [Fact]
    public async Task InternalNote_RemainsUnchangedAfterActorRenameAndCannotBeEdited()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = new ReservationActivityService(db, new TestPermissions(true));
        await service.CreateInternalNoteAsync(10, 20, "Original note");
        var actor = await db.Users.SingleAsync(user => user.Id == 20);
        actor.FirstName = "Changed";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var note = await db.ReservationActivities.SingleAsync();
        Assert.Equal("Ada Lovelace", note.ActorDisplayName);
        note.Details = "Changed note";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Append_SnapshotsActorNameAndKeepsItAfterUserRename()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = new ReservationActivityService(db, new TestPermissions(true));

        var activity = await service.AppendAsync(10, 20, "StatusChanged",
            ReservationActivityVisibility.Internal, "  Status changed  ", "  Approved  ", "Payment", 30);
        Assert.Equal("Ada Lovelace", activity.ActorDisplayName);
        Assert.Equal("Status changed", activity.Title);
        Assert.Equal("Approved", activity.Details);
        Assert.Equal(DateTimeKind.Utc, activity.OccurredAtUtc.Kind);

        var actor = await db.Users.SingleAsync(user => user.Id == 20);
        actor.FirstName = "Changed";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var saved = await db.ReservationActivities.SingleAsync();
        Assert.Equal("Ada Lovelace", saved.ActorDisplayName);
        Assert.Equal(30, saved.RelatedEntityId);
    }

    [Fact]
    public async Task Append_SystemActorAndVisibilityAreStoredWithoutUser()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = new ReservationActivityService(db, new TestPermissions(true));

        var activity = await service.AppendAsync(10, null, "Created",
            ReservationActivityVisibility.PropertyVisible, "Reservation created");

        Assert.Null(activity.ActorUserId);
        Assert.Equal("System", activity.ActorDisplayName);
        Assert.Equal(ReservationActivityVisibility.PropertyVisible, activity.Visibility);
        Assert.Null(activity.RelatedEntityType);
        Assert.Null(activity.RelatedEntityId);
    }

    [Fact]
    public async Task Append_RejectsMissingActorOrReservationAndPartialRelatedEntity()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = new ReservationActivityService(db, new TestPermissions(true));

        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.AppendAsync(
            99, null, "Created", ReservationActivityVisibility.Internal, "Created"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.AppendAsync(
            10, 99, "Created", ReservationActivityVisibility.Internal, "Created"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.AppendAsync(
            10, null, "Created", ReservationActivityVisibility.Internal, "Created", relatedEntityType: "Payment"));
        Assert.Empty(db.ReservationActivities);
    }

    [Fact]
    public async Task ListForAdmin_RequiresPropertyReservationReadPermissionAndReturnsOrderedHistory()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var permissions = new TestPermissions(false);
        var service = new ReservationActivityService(db, permissions);
        await service.AppendAsync(10, null, "Created", ReservationActivityVisibility.PropertyVisible, "First");
        await service.AppendAsync(10, 20, "Changed", ReservationActivityVisibility.Internal, "Second");

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListForAdminAsync(10, 20));
        Assert.Equal((20, 11, "bookings.view"), permissions.LastCheck);
        permissions.Allowed = true;
        var items = await service.ListForAdminAsync(10, 20);
        Assert.Equal(["First", "Second"], items.Select(item => item.Title).ToArray());
        Assert.Contains(items, item => item.Visibility == ReservationActivityVisibility.Internal);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.ListForAdminAsync(99, 20));
    }

    [Fact]
    public async Task OwnerList_ReturnsOnlySafePropertyActivitiesInChronologicalPages()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        db.ReservationActivities.AddRange(
            Activity(1, "Created", ReservationActivityVisibility.PropertyVisible, "Created", 1),
            Activity(2, "InternalNote", ReservationActivityVisibility.Internal, "Private note", 2),
            Activity(3, "AdminTaskCreated", ReservationActivityVisibility.Internal, "Private task", 3),
            Activity(4, "AdminTaskCreated", ReservationActivityVisibility.PropertyVisible, "Misclassified task", 4),
            Activity(5, "InternalNote", ReservationActivityVisibility.PropertyVisible, "Misclassified note", 5),
            Activity(6, "Approved", ReservationActivityVisibility.PropertyVisible, "Approved", 6),
            new ReservationActivity
            {
                Id = 7, ReservationId = 10, ActivityType = "Approved",
                Visibility = ReservationActivityVisibility.PropertyVisible,
                Title = "Misclassified linked task", Details = "Private task detail",
                ActorDisplayName = "Admin", OccurredAtUtc = new DateTime(2026, 1, 7, 0, 0, 0, DateTimeKind.Utc),
                RelatedEntityType = nameof(AdminTask), RelatedEntityId = 100
            });
        await db.SaveChangesAsync();
        var permissions = new TestPermissions(true);
        var service = new ReservationActivityService(db, permissions);
        var controller = new OwnerReservationActivitiesController(service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "20"),
             new Claim(ClaimTypes.Role, UserRole.Client.ToString())], "test"));

        var firstResult = await controller.List(11, 10,
            new OwnerReservationActivityQuery { Page = 1, PageSize = 1 }, default);
        var first = Assert.IsType<PagedResult<OwnerReservationActivityResponse>>(
            Assert.IsType<OkObjectResult>(firstResult.Result).Value);
        Assert.Equal(2, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal("Created", Assert.Single(first.Items).ActivityType);
        Assert.Equal((20, 11, "bookings.view"), permissions.LastCheck);

        var second = await service.ListForOwnerAsync(11, 10, 20,
            new OwnerReservationActivityQuery { Page = 2, PageSize = 1 });
        var activity = Assert.Single(second.Items);
        Assert.Equal("Approved", activity.ActivityType);
        Assert.Equal("Approved", activity.Title);
        Assert.Equal("Safe detail", activity.Details);
        Assert.Equal("Owner", activity.ActorDisplayName);
        Assert.Equal(new DateTime(2026, 1, 6, 0, 0, 0, DateTimeKind.Utc), activity.OccurredAtUtc);
        Assert.Equal(["ActivityType", "Title", "Details", "ActorDisplayName", "OccurredAtUtc"],
            typeof(OwnerReservationActivityResponse).GetProperties().Select(property => property.Name).ToArray());
    }

    [Fact]
    public async Task OwnerList_EnforcesMembershipPermissionAndReservationProperty()
    {
        await using var db = CreateContext();
        db.Users.AddRange(
            new User { Id = 20, IsActive = true, Role = UserRole.Client },
            new User { Id = 21, IsActive = true, Role = UserRole.Client },
            new User { Id = 22, IsActive = true, Role = UserRole.Client },
            new User { Id = 23, IsActive = true, Role = UserRole.Client });
        db.Properties.AddRange(
            new Property { Id = 11, OwnerId = 20 },
            new Property { Id = 12, OwnerId = 23 });
        db.Reservations.AddRange(
            new Reservation { Id = 10, PropertyId = 11, ClientId = 20 },
            new Reservation { Id = 12, PropertyId = 12, ClientId = 23 });
        db.UserPropertyAccesses.AddRange(
            new UserPropertyAccess
            {
                UserId = 20, PropertyId = 11, PropertyRole = PropertyUserRole.PropertyOwner,
                PermissionMatrixJson = JsonSerializer.Serialize(PropertyPermissionMatrixDefaults.CreateOwner())
            },
            new UserPropertyAccess
            {
                UserId = 21, PropertyId = 11, PropertyRole = PropertyUserRole.Manager,
                PermissionMatrixJson = "{\"Bookings\":{\"View\":false}}"
            });
        await db.SaveChangesAsync();
        var service = new ReservationActivityService(db,
            new PermissionService(db, new PropertyAccessService(db)));
        var query = new OwnerReservationActivityQuery();

        Assert.Empty((await service.ListForOwnerAsync(11, 10, 20, query)).Items);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListForOwnerAsync(11, 10, 21, query));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListForOwnerAsync(11, 10, 22, query));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListForOwnerAsync(12, 12, 20, query));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.ListForOwnerAsync(11, 12, 20, query));
    }

    [Fact]
    public void OwnerActivityRoute_IsAuthenticatedReadOnlyAndPropertyScoped()
    {
        var controller = typeof(OwnerReservationActivitiesController);
        Assert.NotNull(Assert.Single(controller.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), true)));
        var route = Assert.Single(controller.GetCustomAttributes(typeof(RouteAttribute), true)) as RouteAttribute;
        Assert.Equal("api/owner/properties/{propertyId:int}/reservations/{reservationId:int}/activities",
            route?.Template);
        Assert.NotNull(Assert.Single(controller.GetMethod(nameof(OwnerReservationActivitiesController.List))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true)));
        Assert.DoesNotContain(controller.GetMethods(), method => method.DeclaringType == controller &&
            method.GetCustomAttributes(typeof(HttpPostAttribute), true).Length > 0);
    }

    private static ReservationActivity Activity(int id, string type, ReservationActivityVisibility visibility,
        string title, int day, int reservationId = 10) => new()
    {
        Id = id,
        ReservationId = reservationId,
        ActivityType = type,
        Visibility = visibility,
        Title = title,
        Details = "Safe detail",
        ActorDisplayName = "Owner",
        OccurredAtUtc = new DateTime(2026, 1, day, 0, 0, 0, DateTimeKind.Utc)
    };

    [Fact]
    public async Task DbContext_RejectsUpdateDeleteAndSoftDelete()
    {
        await using var db = CreateContext();
        var activity = new ReservationActivity { Id = 1 };
        db.Attach(activity);
        activity.Title = "Changed";
        Assert.Contains("append-only", (await Assert.ThrowsAsync<InvalidOperationException>(
            () => db.SaveChangesAsync())).Message);

        db.Entry(activity).State = EntityState.Deleted;
        Assert.Contains("append-only", Assert.Throws<InvalidOperationException>(
            () => db.SaveChanges()).Message);

        db.Entry(activity).State = EntityState.Unchanged;
        activity.IsDeleted = true;
        Assert.Contains("append-only", (await Assert.ThrowsAsync<InvalidOperationException>(
            () => db.SaveChangesAsync())).Message);
    }

    [Fact]
    public void Model_HasHistoricalNoActionLinksAndRequiredFields()
    {
        using var db = CreateContext();
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(ReservationActivity))!;
        Assert.Equal(200, entity.FindProperty(nameof(ReservationActivity.ActorDisplayName))!.GetMaxLength());
        Assert.Equal(100, entity.FindProperty(nameof(ReservationActivity.ActivityType))!.GetMaxLength());
        Assert.Equal(250, entity.FindProperty(nameof(ReservationActivity.Title))!.GetMaxLength());
        Assert.Equal(4000, entity.FindProperty(nameof(ReservationActivity.Details))!.GetMaxLength());
        Assert.All(entity.GetForeignKeys(), key => Assert.Equal(DeleteBehavior.NoAction, key.DeleteBehavior));
    }

    [Fact]
    public void AdminRoute_RequiresAdminAndExistingReservationWritePermissionForNotes()
    {
        var controller = typeof(AdminReservationActivitiesController);
        Assert.NotNull(Assert.Single(controller.GetCustomAttributes(typeof(AdminAuthorizeAttribute), true)));
        var create = controller.GetMethod(nameof(AdminReservationActivitiesController.CreateInternalNote))!;
        var permission = Assert.Single(create.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true))
            as PermissionAuthorizeAttribute;
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ManageReservations}", permission?.Policy);
        Assert.DoesNotContain(controller.GetMethods(), method => method.DeclaringType == controller &&
            method.Name is "Update" or "Delete");
        Assert.Equal([nameof(CreateReservationInternalNoteRequest.Details)],
            typeof(CreateReservationInternalNoteRequest).GetProperties().Select(property => property.Name).ToArray());
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"reservation-activities-{Guid.NewGuid():N}").Options);

    private static async Task SeedAsync(KoochDbContext db)
    {
        db.Users.Add(new User { Id = 20, FirstName = "Ada", LastName = "Lovelace" });
        db.Reservations.Add(new Reservation { Id = 10, PropertyId = 11, ClientId = 20 });
        await db.SaveChangesAsync();
    }

    private sealed class TestPermissions(bool allowed) : IPermissionService
    {
        public bool Allowed { get; set; } = allowed;
        public bool PlatformAllowed { get; set; } = true;
        public (int UserId, int PropertyId, string Key) LastCheck { get; private set; }
        public PermissionKey? LastPlatformPermission { get; private set; }

        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default)
        {
            LastCheck = (userId, propertyId, permissionKey);
            return Task.FromResult(Allowed);
        }

        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default)
        {
            LastPlatformPermission = permissionKey;
            return Task.FromResult(PlatformAllowed);
        }
    }
}
