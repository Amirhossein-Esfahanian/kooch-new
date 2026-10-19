using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Announcements;
using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Reflection;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminAnnouncementTests
{
    [Fact]
    public async Task RecipientLookup_UsesManageNotificationsAndReturnsOnlyActiveEligibleUsers()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        db.Properties.AddRange(
            new Property { Id = 10, OwnerId = 3, Name = "One", Slug = "one" },
            new Property { Id = 11, OwnerId = 3, Name = "Two", Slug = "two" },
            new Property { Id = 12, OwnerId = 8, Name = "Deleted", Slug = "deleted", IsDeleted = true });
        db.Users.AddRange(
            new User { Id = 7, FirstName = "Suspended", Role = UserRole.Client },
            new User { Id = 8, FirstName = "Former", Role = UserRole.Client });
        db.UserPropertyAccesses.AddRange(
            OwnerAccess(3, 10), OwnerAccess(3, 11),
            OwnerAccess(4, 10),
            OwnerAccess(7, 10, PropertyUserStatus.Suspended),
            OwnerAccess(8, 12),
            new UserPropertyAccess { UserId = 5, PropertyId = 10,
                PropertyRole = PropertyUserRole.Manager, Status = PropertyUserStatus.Active, IsActive = true });
        await db.SaveChangesAsync();
        var service = CreateService(db);

        var admins = await service.SearchRecipientsAsync(2, new()
        {
            Target = AdminAnnouncementTarget.SelectedAdmins, PageSize = 1
        });
        Assert.Equal(2, admins.TotalCount);
        Assert.Equal(2, admins.TotalPages);
        Assert.Equal(1, Assert.Single(admins.Items).Id);
        var next = await service.SearchRecipientsAsync(2, new()
        {
            Target = AdminAnnouncementTarget.SelectedAdmins, Page = 2, PageSize = 1, Search = "Bea"
        });
        Assert.Empty(next.Items);
        var owner = await service.SearchRecipientsAsync(2, new()
        {
            Target = AdminAnnouncementTarget.SelectedPropertyOwners, Search = "Owner"
        });
        Assert.Equal(1, owner.TotalCount);
        Assert.Equal(3, Assert.Single(owner.Items).Id);
        Assert.Equal("Owner", owner.Items[0].DisplayName);
        Assert.Equal([nameof(AdminAnnouncementRecipientOption.Id), nameof(AdminAnnouncementRecipientOption.DisplayName)],
            typeof(AdminAnnouncementRecipientOption).GetProperties().Select(property => property.Name).ToArray());
    }

    [Fact]
    public async Task RecipientLookup_RejectsUnauthorizedActorsAndAllRecipientTargets()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        var denied = CreateService(db, new TestPermissions { Allowed = false });
        var query = new AdminAnnouncementRecipientSearchQuery
        {
            Target = AdminAnnouncementTarget.SelectedAdmins
        };
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => denied.SearchRecipientsAsync(2, query));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => CreateService(db).SearchRecipientsAsync(3, query));
        await Assert.ThrowsAsync<ArgumentException>(() => CreateService(db).SearchRecipientsAsync(2,
            new() { Target = AdminAnnouncementTarget.AllAdmins }));
        var endpoint = typeof(AdminAnnouncementsController).GetMethod(nameof(AdminAnnouncementsController.SearchRecipients))!;
        Assert.Equal("recipients", endpoint.GetCustomAttribute<Microsoft.AspNetCore.Mvc.HttpGetAttribute>()?.Template);
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ManageNotifications).Policy,
            typeof(AdminAnnouncementsController).GetCustomAttribute<PermissionAuthorizeAttribute>()?.Policy);
    }

    [Fact]
    public async Task SelectedAdmins_DeduplicatesSnapshotsAndReplaysWithoutAnotherDelivery()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        var service = CreateService(db);
        var request = Request(AdminAnnouncementTarget.SelectedAdmins, [2, 1, 2]);

        var sent = await service.SendAsync(1, request);
        var replay = await service.SendAsync(1, request with { RecipientUserIds = [1, 2] });

        Assert.Equal(sent.Id, replay.Id);
        Assert.Equal(2, sent.RecipientCount);
        Assert.Equal([1, 2], sent.RecipientUserIds);
        Assert.Single(db.AdminAnnouncements);
        Assert.Equal(2, await db.AdminAnnouncementRecipients.CountAsync());
        var logs = await db.NotificationLogs.OrderBy(row => row.RecipientUserId).ToArrayAsync();
        Assert.Equal([1, 2], logs.Select(row => row.RecipientUserId).ToArray());
        Assert.All(logs, row =>
        {
            Assert.Equal(NotificationEventType.AdminAnnouncement, row.EventType);
            Assert.Equal(NotificationChannel.InApp, row.Channels);
            Assert.Equal("Maintenance", row.Subject);
            Assert.Equal("Please check the shift notes.", row.Message);
        });
        Assert.Equal(2, (await service.ListAsync(1)).Single().RecipientCount);
        var inbox = await new AccountNotificationInboxService(db).ListAsync(2, new NotificationInboxQuery());
        Assert.Equal(NotificationEventType.AdminAnnouncement, Assert.Single(inbox.Items).EventType);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SendAsync(1,
            request with { Body = "Different" }));
        Assert.Equal(2, await db.NotificationLogs.CountAsync());
    }

    [Fact]
    public async Task PropertyOwners_ResolveFromActiveMembershipAndDeduplicateAcrossProperties()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        db.Properties.AddRange(
            new Property { Id = 10, OwnerId = 3, Name = "One", Slug = "one" },
            new Property { Id = 11, OwnerId = 3, Name = "Two", Slug = "two" });
        db.UserPropertyAccesses.AddRange(
            OwnerAccess(3, 10), OwnerAccess(3, 11),
            OwnerAccess(4, 10, PropertyUserStatus.Inactive),
            new UserPropertyAccess { UserId = 5, PropertyId = 10, PropertyRole = PropertyUserRole.Manager });
        await db.SaveChangesAsync();
        var service = CreateService(db);

        var sent = await service.SendAsync(1, Request(AdminAnnouncementTarget.AllPropertyOwners));
        Assert.Equal([3], sent.RecipientUserIds);
        Assert.Single(db.NotificationLogs);
        Assert.Equal(3, (await db.NotificationLogs.SingleAsync()).RecipientUserId);
        var manager = await db.UserPropertyAccesses.SingleAsync(access => access.UserId == 5);
        manager.PropertyRole = PropertyUserRole.PropertyOwner;
        await db.SaveChangesAsync();
        Assert.Equal([3], (await service.SendAsync(1, Request(AdminAnnouncementTarget.AllPropertyOwners))).RecipientUserIds);
        Assert.Single(db.NotificationLogs);
        await Assert.ThrowsAsync<ArgumentException>(() => service.SendAsync(1,
            Request(AdminAnnouncementTarget.SelectedPropertyOwners, [4]) with { IdempotencyKey = "second" }));
        var selected = await service.SendAsync(1,
            Request(AdminAnnouncementTarget.SelectedPropertyOwners, [3, 3]) with { IdempotencyKey = "third" });
        Assert.Equal([3], selected.RecipientUserIds);
    }

    [Fact]
    public async Task AllAdmins_UsesActiveCanonicalAdminUsersAndRejectsInvalidSelection()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        var service = CreateService(db);
        var sent = await service.SendAsync(1, Request(AdminAnnouncementTarget.AllAdmins));
        Assert.Equal([1, 2], sent.RecipientUserIds);
        await Assert.ThrowsAsync<ArgumentException>(() => service.SendAsync(1,
            Request(AdminAnnouncementTarget.SelectedAdmins, [3]) with { IdempotencyKey = "invalid" }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.SendAsync(1,
            Request(AdminAnnouncementTarget.AllAdmins, [1]) with { IdempotencyKey = "invalid-all" }));
    }

    [Fact]
    public async Task PermissionAndHistoryGuardsProtectAnnouncements()
    {
        await using var db = CreateMemoryDb();
        await SeedAsync(db);
        var denied = CreateService(db, new TestPermissions { Allowed = false });
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => denied.SendAsync(1,
            Request(AdminAnnouncementTarget.AllAdmins)));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => denied.ListAsync(1));
        var service = CreateService(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SendAsync(3,
            Request(AdminAnnouncementTarget.AllAdmins)));
        Assert.Empty(db.AdminAnnouncements);

        var assistantSend = await service.SendAsync(2,
            Request(AdminAnnouncementTarget.SelectedAdmins, [1]) with { IdempotencyKey = "assistant-send" });
        Assert.Equal(2, assistantSend.SenderUserId);

        var sent = await service.SendAsync(1, Request(AdminAnnouncementTarget.AllAdmins));
        var row = await db.AdminAnnouncements.SingleAsync(announcement => announcement.Id == sent.Id);
        row.Title = "Changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var recipient = await db.AdminAnnouncementRecipients.FirstAsync();
        db.AdminAnnouncementRecipients.Remove(recipient);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        Assert.Equal(sent.RecipientUserIds, (await service.GetAsync(1, sent.Id)).RecipientUserIds);
        Assert.Equal("Maintenance", (await service.GetAsync(1, sent.Id)).Title);
        db.AdminAnnouncementRecipients.Add(new AdminAnnouncementRecipient
        {
            AnnouncementId = sent.Id, UserId = 5
        });
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        Assert.Single(typeof(AdminAnnouncementsController)
            .GetCustomAttributes(typeof(AdminAuthorizeAttribute), true));
        var permission = Assert.Single(typeof(AdminAnnouncementsController)
            .GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true)) as PermissionAuthorizeAttribute;
        Assert.Equal($"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ManageNotifications}", permission?.Policy);
    }

    [Fact]
    public async Task RelationalNotificationFailure_RollsBackAnnouncementRecipientsAndEarlierAlerts()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using (var db = new KoochDbContext(options))
        {
            await db.Database.EnsureCreatedAsync();
            await SeedAsync(db);
            var service = new AdminAnnouncementService(db, new TestPermissions(),
                new FailSecondNotification(new NotificationService(db)));
            var recipients = await service.SearchRecipientsAsync(2,
                new() { Target = AdminAnnouncementTarget.SelectedAdmins });
            Assert.Equal([1, 2], recipients.Items.Select(item => item.Id).ToArray());
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.SendAsync(1,
                Request(AdminAnnouncementTarget.AllAdmins)));
        }
        await using var verify = new KoochDbContext(options);
        Assert.Empty(await verify.AdminAnnouncements.ToListAsync());
        Assert.Empty(await verify.AdminAnnouncementRecipients.ToListAsync());
        Assert.Empty(await verify.NotificationLogs.ToListAsync());
    }

    private static SendAdminAnnouncementRequest Request(AdminAnnouncementTarget target,
        IReadOnlyList<int>? recipients = null) =>
        new("request-one", "  Maintenance  ", "  Please check the shift notes.  ", target, recipients);

    private static UserPropertyAccess OwnerAccess(int userId, int propertyId,
        PropertyUserStatus status = PropertyUserStatus.Active) => new()
    {
        UserId = userId, PropertyId = propertyId, PropertyRole = PropertyUserRole.PropertyOwner,
        Status = status, IsActive = true
    };

    private static AdminAnnouncementService CreateService(KoochDbContext db,
        TestPermissions? permissions = null) =>
        new(db, permissions ?? new TestPermissions(), new NotificationService(db));

    private static KoochDbContext CreateMemoryDb() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase($"admin-announcements-{Guid.NewGuid():N}").Options);

    private static async Task SeedAsync(KoochDbContext db)
    {
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Ada", Role = UserRole.SuperAdmin },
            new User { Id = 2, FirstName = "Bea", Role = UserRole.AdminAssistant },
            new User { Id = 3, FirstName = "Owner", Role = UserRole.Client },
            new User { Id = 4, FirstName = "Inactive", Role = UserRole.Client, IsActive = false },
            new User { Id = 5, FirstName = "Manager", Role = UserRole.Client },
            new User { Id = 6, FirstName = "Disabled", Role = UserRole.AdminAssistant, IsActive = false });
        await db.SaveChangesAsync();
    }

    private sealed class TestPermissions : IPermissionService
    {
        public bool Allowed { get; set; } = true;
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey,
            int? propertyId = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(Allowed && permissionKey == PermissionKey.ManageNotifications);
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class FailSecondNotification(INotificationService inner) : INotificationService
    {
        private int count;
        public async Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default)
        {
            if (++count == 2) throw new InvalidOperationException("Simulated delivery failure.");
            await inner.SendAsync(request, cancellationToken);
        }
    }
}
