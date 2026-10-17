using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationActivityTests
{
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
    public void AdminRoute_IsReadOnlyAndRequiresAdminWorkspace()
    {
        var controller = typeof(AdminReservationActivitiesController);
        Assert.NotNull(Assert.Single(controller.GetCustomAttributes(typeof(AdminAuthorizeAttribute), true)));
        Assert.Single(controller.GetMethods(), method => method.DeclaringType == controller);
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
        public (int UserId, int PropertyId, string Key) LastCheck { get; private set; }

        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default)
        {
            LastCheck = (userId, propertyId, permissionKey);
            return Task.FromResult(Allowed);
        }

        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}
