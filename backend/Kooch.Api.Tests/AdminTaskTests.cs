using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AdminTasks;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));

        var created = await service.CreateAsync(1, Request(reservationId: 10));
        Assert.Equal(AdminTaskStatus.Open, created.Status);
        Assert.Equal(1, created.CreatedByUserId);
        Assert.Single(created.Changes);
        Assert.Equal("Ada Admin", created.Changes[0].ActorDisplayName);
        Assert.Equal(AdminTaskChangeType.Created, created.Changes[0].ChangeType);
        var reassigned = await service.ReassignAsync(1, created.Id, new ReassignAdminTaskRequest(2));
        var alerts = await db.NotificationLogs.OrderBy(log => log.Id).ToListAsync();
        Assert.Equal(2, alerts.Count);
        Assert.Equal([1, 2], alerts.Select(log => log.RecipientUserId).ToArray());
        Assert.All(alerts, log =>
        {
            Assert.Equal(NotificationEventType.AdminTaskAssigned, log.EventType);
            Assert.Equal(NotificationChannel.InApp, log.Channels);
            Assert.Contains("Follow up", log.Message);
            Assert.Contains("Ada Admin", log.Message);
            Assert.Contains("/admin/tasks", log.DataJson);
        });
        Assert.Equal(2, reassigned.AssignedToUserId);
        await Assert.ThrowsAsync<ArgumentException>(() => service.ReassignAsync(1, created.Id,
            new ReassignAdminTaskRequest(2)));
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
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
        var created = await service.CreateAsync(1, Request());
        var listed = await service.ListAsync(1);
        Assert.Single(listed);
        Assert.Empty(listed[0].Changes);
        var cancelled = await service.UpdateStatusAsync(1, created.Id,
            new UpdateAdminTaskStatusRequest(AdminTaskStatus.Cancelled, null));
        Assert.Equal(AdminTaskStatus.Cancelled, cancelled.Status);
        Assert.Equal(2, cancelled.Changes.Count);
        Assert.Empty(db.ReservationActivities);
        Assert.Single(db.NotificationLogs);
    }

    [Fact]
    public async Task MineUnfinished_FiltersBeforePagingAndOrdersDueThenUndatedTasks()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        await using var db = new TaskSqliteDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        await SeedAsync(db);
        var due = new DateTime(2026, 10, 21, 12, 0, 0, DateTimeKind.Utc);
        db.AdminTasks.AddRange(
            TaskRow("later", 1, AdminTaskStatus.Open, due.AddDays(1)),
            TaskRow("earlier", 1, AdminTaskStatus.InProgress, due.AddDays(-1)),
            TaskRow("undated-old", 1, AdminTaskStatus.Open),
            TaskRow("undated-new", 1, AdminTaskStatus.InProgress),
            TaskRow("done", 1, AdminTaskStatus.Done, due.AddDays(-2)),
            TaskRow("cancelled", 1, AdminTaskStatus.Cancelled, due.AddDays(-2)),
            TaskRow("other-admin", 2, AdminTaskStatus.Open, due.AddDays(-2)));
        await db.SaveChangesAsync();
        var service = new AdminTaskService(db, new TestPermissions(),
            new ReservationActivityService(db, new TestPermissions()), new NotificationService(db));

        var first = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery { PageSize = 2 });
        var second = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery { Page = 2, PageSize = 2 });

        Assert.Equal(["earlier", "later"], first.Items.Select(item => item.Title).ToArray());
        Assert.Equal(["undated-new", "undated-old"], second.Items.Select(item => item.Title).ToArray());
        Assert.All(first.Items.Concat(second.Items), item => Assert.True(item.Id > 0));
        Assert.All(first.Items.Concat(second.Items), item =>
            Assert.True(item.Status is AdminTaskStatus.Open or AdminTaskStatus.InProgress));
        Assert.Equal((4, 1, 2, 2), (first.TotalCount, first.Page, first.PageSize, first.TotalPages));
        Assert.Equal((4, 2, 2, 2), (second.TotalCount, second.Page, second.PageSize, second.TotalPages));
        Assert.Equal(7, (await service.ListAsync(1)).Count);
    }

    [Fact]
    public async Task MineUnfinished_BoundsPageSizeAndExcludesInaccessibleLinkedTasks()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        db.AdminTasks.AddRange(Enumerable.Range(1, 60)
            .Select(index => TaskRow($"task-{index}", 1, AdminTaskStatus.Open)));
        db.AdminTasks.Add(TaskRow("linked", 1, AdminTaskStatus.Open, reservationId: 10));
        await db.SaveChangesAsync();
        var permissions = new TestPermissions { PropertyAllowed = false };
        var service = new AdminTaskService(db, permissions,
            new ReservationActivityService(db, permissions), new NotificationService(db));

        var first = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery { Page = -3, PageSize = 999 });
        var second = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery { Page = 2, PageSize = 999 });
        var small = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery { PageSize = 0 });
        var defaults = await service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery());

        Assert.Equal((60, 1, 50, 2, 50),
            (first.TotalCount, first.Page, first.PageSize, first.TotalPages, first.Items.Count));
        Assert.Equal(10, second.Items.Count);
        Assert.Empty(first.Items.Select(item => item.Id).Intersect(second.Items.Select(item => item.Id)));
        Assert.Single(small.Items);
        Assert.Equal(1, small.PageSize);
        Assert.Equal(5, defaults.Items.Count);
        Assert.Equal(5, defaults.PageSize);
        Assert.DoesNotContain(first.Items.Concat(second.Items), item => item.Title == "linked");
    }

    [Fact]
    public async Task MineUnfinished_RequiresManageReservationsAndKeepsExistingListRoute()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { PlatformAllowed = false };
        var service = new AdminTaskService(db, permissions,
            new ReservationActivityService(db, permissions), new NotificationService(db));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.ListMineUnfinishedAsync(1, new AdminTaskUnfinishedQuery()));

        var controller = typeof(AdminTasksController);
        Assert.Single(controller.GetCustomAttributes(typeof(AdminAuthorizeAttribute), true));
        var permission = Assert.Single(controller.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true))
            as PermissionAuthorizeAttribute;
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ManageReservations}", permission?.Policy);
        var mine = controller.GetMethod(nameof(AdminTasksController.ListMineUnfinished))!;
        Assert.Equal("mine/unfinished", Assert.IsType<HttpGetAttribute>(
            Assert.Single(mine.GetCustomAttributes(typeof(HttpGetAttribute), true))).Template);
        var list = controller.GetMethod(nameof(AdminTasksController.List))!;
        Assert.Null(Assert.IsType<HttpGetAttribute>(
            Assert.Single(list.GetCustomAttributes(typeof(HttpGetAttribute), true))).Template);
    }

    [Fact]
    public async Task MineUnfinished_ControllerUsesAuthenticatedUserIdNotQueryInput()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        db.AdminTasks.AddRange(
            TaskRow("first-admin", 1, AdminTaskStatus.Open),
            TaskRow("second-admin", 2, AdminTaskStatus.Open));
        await db.SaveChangesAsync();
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions,
            new ReservationActivityService(db, permissions), new NotificationService(db));
        var controller = new AdminTasksController(service)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "2"),
                     new Claim(ClaimTypes.Role, nameof(UserRole.AdminAssistant))], "test"))
                }
            }
        };

        var response = await controller.ListMineUnfinished(new AdminTaskUnfinishedQuery(), CancellationToken.None);
        var result = Assert.IsType<PagedResult<AdminTaskUnfinishedItemResponse>>(
            Assert.IsType<OkObjectResult>(response.Result).Value);
        Assert.Equal("second-admin", Assert.Single(result.Items).Title);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task AssigneeLookup_UsesTaskPermissionAndReturnsOnlyActiveAdmins()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        db.Users.Add(new User { Id = 4, FirstName = "Inactive", Role = UserRole.AdminAssistant, IsActive = false });
        db.Users.Add(new User { Id = 5, Role = UserRole.AdminAssistant });
        await db.SaveChangesAsync();
        var permissions = new TestPermissions();
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));

        Assert.Equal([(5, "Admin 5"), (1, "Ada Admin"), (2, "Bea Assistant")],
            (await service.ListAssigneesAsync(1)).Select(user => (user.Id, user.DisplayName)).ToArray());
        permissions.PlatformAllowed = false;
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListAssigneesAsync(1));
        Assert.Equal("assignees", typeof(AdminTasksController).GetMethod(nameof(AdminTasksController.ListAssignees))!
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.HttpGetAttribute), true)
            .Cast<Microsoft.AspNetCore.Mvc.HttpGetAttribute>().Single().Template);
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
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1,
            Request() with { AssignedToUserId = assignee }));
        Assert.Empty(db.AdminTasks);
        Assert.Empty(db.NotificationLogs);
    }

    [Fact]
    public async Task Create_RejectsAssigneeWithoutTaskPermissionBeforeWritingAlert()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { DeniedUserId = 2 };
        var service = new AdminTaskService(db, permissions,
            new ReservationActivityService(db, permissions), new NotificationService(db));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1,
            Request() with { AssignedToUserId = 2 }));
        Assert.Empty(db.AdminTasks);
        Assert.Empty(db.NotificationLogs);
    }

    [Fact]
    public async Task LinkedTask_RequiresPropertyAccessForWritesAndReads()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { PropertyAllowed = false };
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
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
        Assert.Single(db.NotificationLogs);
    }

    [Fact]
    public async Task GlobalPermissionAndValidationRejectInvalidMutations()
    {
        await using var db = CreateDb();
        await SeedAsync(db);
        var permissions = new TestPermissions { PlatformAllowed = false };
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
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
        var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
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
            var service = new AdminTaskService(db, permissions, new ReservationActivityService(db, permissions), new NotificationService(db));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, Request(reservationId: 10)));
        }
        await using var verify = new TaskSqliteDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).Options);
        Assert.Empty(await verify.AdminTasks.ToListAsync());
        Assert.Empty(await verify.AdminTaskChanges.ToListAsync());
        Assert.Empty(await verify.ReservationActivities.ToListAsync());
        Assert.Empty(await verify.NotificationLogs.ToListAsync());
    }

    [Fact]
    public async Task RelationalTransaction_RollsBackAssignmentWhenNotificationWriteFails()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).AddInterceptors(new RejectNotificationInterceptor()).Options;
        await using (var db = new TaskSqliteDbContext(options))
        {
            await db.Database.EnsureCreatedAsync();
            await SeedAsync(db);
            var permissions = new TestPermissions();
            var service = new AdminTaskService(db, permissions,
                new ReservationActivityService(db, permissions), new NotificationService(db));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, Request(reservationId: 10)));
        }
        await using var verify = new TaskSqliteDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).Options);
        Assert.Empty(await verify.AdminTasks.ToListAsync());
        Assert.Empty(await verify.AdminTaskChanges.ToListAsync());
        Assert.Empty(await verify.ReservationActivities.ToListAsync());
        Assert.Empty(await verify.NotificationLogs.ToListAsync());
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

    private static AdminTask TaskRow(string title, int assigneeId, AdminTaskStatus status,
        DateTime? dueAtUtc = null, int? reservationId = null) => new()
    {
        Title = title, Priority = AdminTaskPriority.Normal, Status = status,
        DueAtUtc = dueAtUtc, CreatedByUserId = 1, AssignedToUserId = assigneeId,
        ReservationId = reservationId
    };

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

    private sealed class RejectNotificationInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context?.ChangeTracker.Entries<NotificationLog>()
                .Any(entry => entry.State == EntityState.Added) == true)
                throw new InvalidOperationException("Simulated notification write failure.");
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private sealed class TestPermissions : IPermissionService
    {
        public bool PlatformAllowed { get; set; } = true;
        public int? DeniedUserId { get; set; }
        public bool PropertyAllowed { get; set; } = true;
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey,
            int? propertyId = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(PlatformAllowed && userId != DeniedUserId && permissionKey == PermissionKey.ManageReservations);
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(PropertyAllowed);
    }
}
