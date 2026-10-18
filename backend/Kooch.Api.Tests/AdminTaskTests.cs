using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AdminTasks;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminTaskTests
{
    [Fact]
    public async Task LinkedTask_CreatesReassignsAndCompletesWithImmutableInternalActivityAndHistory()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));

        var created = await service.CreateAsync(1, Request(reservationId: 10));
        Assert.Equal(AdminTaskStatus.Open, created.Status);
        Assert.Equal(1, created.CreatedByUserId);
        Assert.Single(created.Changes);
        Assert.Equal("Ada Admin", created.Changes[0].ActorDisplayName);
        Assert.Equal(AdminTaskChangeType.Created, created.Changes[0].ChangeType);
        var reassigned = await service.ReassignAsync(1, created.Id, new ReassignAdminTaskRequest(2));
        Assert.Equal(2, reassigned.AssignedToUserId);
        Assert.Equal((1, 2), (reassigned.Changes[1].PreviousAssigneeUserId,
            reassigned.Changes[1].NewAssigneeUserId));
        await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.InProgress, null));
        var done = await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.Done, "  Handed over  "));

        Assert.Equal(AdminTaskStatus.Done, done.Status);
        Assert.Equal("Handed over", done.ResolutionNote);
        Assert.NotNull(done.CompletedAtUtc);
        Assert.Equal(4, done.Changes.Count);
        Assert.Equal("Handed over", done.Changes[3].ResolutionNote);
        Assert.Equal(["AdminTaskCreated", "AdminTaskReassigned", "AdminTaskStatusChanged", "AdminTaskCompleted"],
            (await db.ReservationActivities.OrderBy(row => row.Id).ToListAsync())
                .Select(row => row.ActivityType).ToArray());
        Assert.All(await db.ReservationActivities.ToListAsync(), activity =>
        {
            Assert.Equal(ReservationActivityVisibility.Internal, activity.Visibility);
            Assert.Equal(nameof(AdminTask), activity.RelatedEntityType);
            Assert.Equal(created.Id, activity.RelatedEntityId);
            Assert.Equal(10, activity.ReservationId);
        });
        var actor = await db.Users.SingleAsync(row => row.Id == 1);
        actor.FirstName = "Changed";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.All((await service.GetAsync(1, created.Id)).Changes,
            change => Assert.Equal("Ada Admin", change.ActorDisplayName));
        Assert.Equal(4, (await service.GetAsync(1, created.Id)).Changes.Count);
        var reopened = await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.Open, null));
        Assert.Null(reopened.CompletedAtUtc);
        Assert.Equal(5, reopened.Changes.Count);
    }

    [Fact]
    public async Task UnlinkedTask_ListsAndCancelsWithoutReservationActivity()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
        var created = await service.CreateAsync(1, Request());
        var listed = await service.ListAsync(1);
        Assert.Single(listed);
        Assert.Empty(listed[0].Changes);
        var cancelled = await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.Cancelled, null));
        Assert.Equal(AdminTaskStatus.Cancelled, cancelled.Status);
        Assert.Equal(2, cancelled.Changes.Count);
        Assert.Empty(db.ReservationActivities);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(99)]
    public async Task Create_RequiresExistingActiveAdminAssignee(int assignee)
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1,
            Request() with { AssignedToUserId = assignee }));
        Assert.Empty(db.AdminTasks);
    }

    [Fact]
    public async Task LinkedTask_RequiresPropertyAccessForWritesAndReads()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { PropertyAllowed = false };
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateAsync(1, Request(reservationId: 10)));
        Assert.Empty(db.AdminTasks);
        permissions.PropertyAllowed = true;
        var created = await service.CreateAsync(1, Request(reservationId: 10));
        permissions.PropertyAllowed = false;
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetAsync(1, created.Id));
        Assert.Empty(await service.ListAsync(1));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ReassignAsync(1,
            created.Id, new ReassignAdminTaskRequest(2)));
        Assert.Single(db.AdminTaskChanges);
    }

    [Fact]
    public async Task GlobalPermissionAndValidationRejectInvalidMutations()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { PlatformAllowed = false };
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateAsync(1, Request()));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListAsync(1));
        permissions.PlatformAllowed = true;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, Request() with { Title = "  " }));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => service.CreateAsync(1,
            Request() with { Priority = (AdminTaskPriority)99 }));
        var created = await service.CreateAsync(1, Request());
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.Open, null)));
        var inProgress = await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.InProgress, "Working"));
        Assert.Equal("Working", inProgress.ResolutionNote);
        Assert.Equal(2, inProgress.Changes.Count);
    }

    [Fact]
    public async Task TaskHistoryAndTasksCannotBeDeletedOrHistoryEdited()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
        var created = await service.CreateAsync(1, Request());
        var change = await db.AdminTaskChanges.SingleAsync();
        change.ActorDisplayName = "Other";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var task = await db.AdminTasks.SingleAsync(row => row.Id == created.Id);
        db.AdminTasks.Remove(task);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task RelationalTransaction_RollsBackTaskAndHistoryWhenActivityWriteFails()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).AddInterceptors(new RejectActivityInterceptor()).Options;
        await using (var db = new TaskSqliteDbContext(options))
        {
            await db.Database.EnsureCreatedAsync();
            await SeedAsync(db);
            var permissions = new TestPermissions();
            var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, Request(reservationId: 10)));
        }
        await using var verify = new TaskSqliteDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).Options);
        Assert.Empty(await verify.AdminTasks.ToListAsync());
        Assert.Empty(await verify.AdminTaskChanges.ToListAsync());
        Assert.Empty(await verify.ReservationActivities.ToListAsync());
    }

    [Fact]
    public void Controller_UsesExistingAdminReservationPermissionAndHasNoDeleteRoute()
    {
        var controller = typeof(AdminTasksController);
        Assert.Single(controller.GetCustomAttributes(typeof(AdminAuthorizeAttribute), true));
        var permission = Assert.Single(controller.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true))
            as PermissionAuthorizeAttribute;
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ManageReservations}", permission?.Policy);
        Assert.DoesNotContain(controller.GetMethods(), method => method.DeclaringType == controller &&
            method.Name is "Delete" or "UpdateDetails");
    }

    private static CreateAdminTaskRequest Request(int? reservationId = null) =>
        new("  Follow up  ", "  Coordinate shift  ", AdminTaskPriority.High,
            null, 1, reservationId);

    private static KoochDbContext CreateDb() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase($"admin-tasks-{Guid.NewGuid():N}").Options);

    private static async Task SeedAsync(KoochDbContext db)
    {
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Ada", LastName = "Admin", Role = UserRole.SuperAdmin },
            new User { Id = 2, FirstName = "Bea", LastName = "Assistant", Role = UserRole.AdminAssistant },
            new User { Id = 3, FirstName = "Cal", Role = UserRole.Client });
        db.Reservations.Add(new Reservation { Id = 10, PropertyId = 11, ClientId = 3, RowVersion = [1] });
        await db.SaveChangesAsync();
    }

    private sealed class TaskSqliteDbContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<Reservation>().Property(row => row.RowVersion).ValueGeneratedNever();
        }
    }

    private sealed class RejectActivityInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context?.ChangeTracker.Entries<ReservationActivity>()
                .Any(entry => entry.State == EntityState.Added) == true)
                throw new InvalidOperationException("Simulated activity write failure.");
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private sealed class TestPermissions : IPermissionService
    {
        public bool PlatformAllowed { get; set; } = true;
        public bool PropertyAllowed { get; set; } = true;
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey,
            int? propertyId = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(PlatformAllowed && permissionKey == PermissionKey.ManageReservations);
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(PropertyAllowed);
    }
}
