using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class NotificationInboxTests
{
    [Fact]
    public async Task List_IsOwnerScopedNewestFirstPagedAndProjectsOnlySafeFields()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = new AccountNotificationInboxService(db);

        var first = await service.ListAsync(1, new() { Page = 1, PageSize = 2 });
        Assert.Equal(3, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(new[] { 3, 2 }, first.Items.Select(item => item.Id));
        Assert.Equal(NotificationEventType.ReservationCancellationRequested, first.Items[0].EventType);
        Assert.Equal("R-100001", first.Items[0].ReservationNumber);
        Assert.Equal(20, first.Items[0].PropertyId);
        Assert.False(first.Items[0].IsRead);
        Assert.True(first.Items[1].IsRead);
        Assert.NotNull(first.Items[1].ReadAtUtc);

        var second = await service.ListAsync(1, new() { Page = 2, PageSize = 2 });
        Assert.Equal(new[] { 1 }, second.Items.Select(item => item.Id));
        Assert.DoesNotContain(first.Items.Concat(second.Items), item => item.Id == 4);
        Assert.DoesNotContain(typeof(NotificationInboxItemResponse).GetProperties(), property =>
            property.Name is "DataJson" or "RecipientUserId" or "RecipientGuestId" or "InternalLink" or "CreatedByUserId");
    }

    [Fact]
    public async Task UnreadCount_OnlyCountsCurrentUsersUnreadRecords()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = new AccountNotificationInboxService(db);
        Assert.Equal(2, await service.UnreadCountAsync(1));
        Assert.Equal(1, await service.UnreadCountAsync(2));
    }

    [Fact]
    public async Task MarkOne_IsOwnerScopedAndIdempotent()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = new AccountNotificationInboxService(db);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.MarkReadAsync(1, 4));
        await service.MarkReadAsync(1, 3);
        var firstReadAt = (await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 3)).ReadAtUtc;
        Assert.NotNull(firstReadAt);
        await service.MarkReadAsync(1, 3);
        Assert.Equal(firstReadAt, (await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 3)).ReadAtUtc);
        Assert.Equal(1, await service.UnreadCountAsync(1));
        Assert.Null((await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 4)).ReadAtUtc);
        Assert.Equal("Cancellation request", (await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 3)).Message);
    }

    [Fact]
    public async Task MarkAll_OnlyUpdatesOwnUnreadAndPreservesAlreadyReadTime()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = new AccountNotificationInboxService(db);
        var priorReadAt = (await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 2)).ReadAtUtc;

        Assert.Equal(2, await service.MarkAllReadAsync(1));
        Assert.Equal(0, await service.MarkAllReadAsync(1));

        Assert.Equal(0, await service.UnreadCountAsync(1));
        Assert.Equal(1, await service.UnreadCountAsync(2));
        Assert.Equal(priorReadAt, (await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 2)).ReadAtUtc);
        Assert.Null((await db.NotificationLogs.AsNoTracking().SingleAsync(log => log.Id == 4)).ReadAtUtc);
    }

    [Fact]
    public async Task PersistenceGuard_RejectsContentRewriteUnreadResetAndDeletion()
    {
        await using var store = await Store.CreateAsync();
        await using (var db = store.Open())
        {
            var row = await db.NotificationLogs.SingleAsync(log => log.Id == 1);
            row.Message = "rewritten";
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
        await using (var db = store.Open())
        {
            var row = await db.NotificationLogs.SingleAsync(log => log.Id == 2);
            row.ReadAtUtc = null;
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
        await using (var db = store.Open())
        {
            var row = await db.NotificationLogs.SingleAsync(log => log.Id == 1);
            db.NotificationLogs.Remove(row);
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
        await using var verify = store.Open();
        Assert.Equal(4, await verify.NotificationLogs.CountAsync());
        Assert.Equal("First", (await verify.NotificationLogs.SingleAsync(log => log.Id == 1)).Message);
    }

    [Fact]
    public async Task NotificationService_StillDeduplicatesNewLogs()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var notifications = new NotificationService(db);
        var request = new NotificationRequest
        {
            RecipientUserId = 1, EventType = NotificationEventType.ReservationCancellationRequested,
            Channels = NotificationChannel.InApp, Message = "Another request",
            DedupeKey = "inbox-dedupe-test"
        };
        await notifications.SendAsync(request);
        await notifications.SendAsync(request);
        Assert.Single(await db.NotificationLogs.Where(log => log.DedupeKey == request.DedupeKey).ToListAsync());
    }

    [Fact]
    public async Task Controller_UsesAuthenticationAndAuthenticatedUserIdentity()
    {
        Assert.NotNull(typeof(AccountNotificationsController).GetCustomAttribute<AuthorizeAttribute>());
        var route = typeof(AccountNotificationsController).GetCustomAttribute<RouteAttribute>();
        Assert.Equal("api/account/notifications", route?.Template);
        Assert.DoesNotContain(typeof(NotificationInboxQuery).GetProperties(), property => property.Name == "RecipientUserId");
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var controller = new AccountNotificationsController(new AccountNotificationInboxService(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "2"), new Claim(ClaimTypes.Role, UserRole.Client.ToString())], "test"));
        var list = await controller.List(new(), default);
        var result = Assert.IsType<Kooch.Api.Dtos.Reservations.PagedResult<NotificationInboxItemResponse>>(
            Assert.IsType<OkObjectResult>(list.Result).Value);
        Assert.Equal(new[] { 4 }, result.Items.Select(item => item.Id));
    }

    private sealed class Store(string path) : IAsyncDisposable
    {
        public KoochDbContext Open() => new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Foreign Keys=False;Pooling=False").Options);

        public static async Task<Store> CreateAsync()
        {
            var store = new Store(Path.Combine(Path.GetTempPath(), $"kooch-inbox-{Guid.NewGuid():N}.db"));
            await using var db = store.Open();
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(
                new User { Id = 1, FirstName = "One", Role = UserRole.Client },
                new User { Id = 2, FirstName = "Two", Role = UserRole.Client });
            db.Properties.Add(new Property { Id = 20, OwnerId = 1, Name = "Property", Slug = "property" });
            db.RoomTypes.Add(new RoomType { Id = 30, PropertyId = 20, Name = "Room", Slug = "room" });
            db.Guests.Add(new Guest { Id = 40, UserId = 1, FirstName = "One" });
            db.Reservations.Add(new Reservation
            {
                Id = 50, PropertyId = 20, RoomTypeId = 30, ClientId = 1, GuestId = 40,
                ReservationNumber = "R-100001", Status = ReservationStatus.Confirmed,
                CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2)
            });
            var timestamp = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
            db.NotificationLogs.AddRange(
                Log(1, 1, timestamp, "First"),
                Log(2, 1, timestamp, "Second", timestamp.AddMinutes(2)),
                Log(3, 1, timestamp.AddMinutes(3), "Cancellation request", eventType: NotificationEventType.ReservationCancellationRequested),
                Log(4, 2, timestamp.AddMinutes(4), "Other user"));
            db.SaveChanges();
            return store;
        }

        public ValueTask DisposeAsync()
        {
            File.Delete(path);
            return ValueTask.CompletedTask;
        }
    }

    private static NotificationLog Log(int id, int userId, DateTime createdAt, string message,
        DateTime? readAt = null, NotificationEventType eventType = NotificationEventType.ReservationCreated) => new()
    {
        Id = id, RecipientUserId = userId, Recipient = $"user:{userId}", EventType = eventType,
        Channels = NotificationChannel.InApp, Status = NotificationStatus.Logged,
        Subject = "Subject", Message = message, CreatedAtUtc = createdAt, ReadAtUtc = readAt,
        ReservationId = id == 3 ? 50 : null, PropertyId = id == 3 ? 20 : null,
        DataJson = id == 3 ? "{\"reservationNumber\":\"R-100001\",\"internalActorId\":999,\"devOtpCode\":\"secret\"}" : null
    };

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(Microsoft.EntityFrameworkCore.ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<Reservation>().Property(item => item.RowVersion).ValueGeneratedNever();
        }
    }
}
