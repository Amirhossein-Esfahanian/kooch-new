using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCancellationRequestNotificationTests
{
    [Fact]
    public async Task GuestRequest_NotifiesOnlyActiveManagersWithAllRequiredPermissions()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();

        await Service(db).CreateAsync(1, "R-100001", Request());

        var request = await db.ReservationCancellationRequests.SingleAsync();
        var logs = await db.NotificationLogs.OrderBy(log => log.RecipientUserId).ToListAsync();
        Assert.Equal(new int?[] { 2, 3, 10 }, logs.Select(log => log.RecipientUserId).ToArray());
        Assert.All(logs, log =>
        {
            Assert.Equal(NotificationEventType.ReservationCancellationRequested, log.EventType);
            Assert.Equal(NotificationChannel.InApp, log.Channels);
            Assert.Equal("درخواست لغو جدید", log.Subject);
            Assert.Equal("برای رزرو R-100001 درخواست لغو ثبت شده است.", log.Message);
            Assert.Equal(20, log.PropertyId);
            Assert.Equal(30, log.ReservationId);
            Assert.Equal($"reservation-cancellation-request:{request.Id}:recipient:{log.RecipientUserId}", log.DedupeKey);
            using var data = JsonDocument.Parse(log.DataJson!);
            Assert.Equal("R-100001", data.RootElement.GetProperty("reservationNumber").GetString());
            Assert.Equal("GuestOnline", data.RootElement.GetProperty("requestSource").GetString());
            Assert.False(data.RootElement.TryGetProperty("propertyId", out _));
        });
        Assert.Equal(logs.Count, logs.Select(log => log.DedupeKey).Distinct().Count());
        await AssertFinanceUnchanged(db);
    }

    [Fact]
    public async Task SupportRequest_UsesSamePathButExcludesCreator()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();

        await Service(db).CreateForSupportAsync(30, 2, UserRole.SuperAdmin, Request());

        var logs = await db.NotificationLogs.OrderBy(log => log.RecipientUserId).ToListAsync();
        Assert.Equal(new int?[] { 3, 10 }, logs.Select(log => log.RecipientUserId).ToArray());
        Assert.All(logs, log =>
        {
            using var data = JsonDocument.Parse(log.DataJson!);
            Assert.Equal("Support", data.RootElement.GetProperty("requestSource").GetString());
        });
        await AssertFinanceUnchanged(db);
    }

    [Fact]
    public async Task DuplicatePendingRequest_DoesNotAddNotifications()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = Service(db);
        await service.CreateAsync(1, "R-100001", Request());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, "R-100001", Request()));
        Assert.Equal(3, await db.NotificationLogs.CountAsync());
        Assert.Single(await db.ReservationCancellationRequests.ToListAsync());
    }

    [Fact]
    public async Task LaterRequestAfterRejection_GetsDistinctDedupeKeys()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = Service(db);
        await service.CreateAsync(1, "R-100001", Request());
        await service.RejectAsync(30, 2, UserRole.SuperAdmin, null);
        await service.CreateAsync(1, "R-100001", Request());
        var logs = await db.NotificationLogs.ToListAsync();
        Assert.Equal(6, logs.Count);
        Assert.Equal(6, logs.Select(log => log.DedupeKey).Distinct().Count());
        Assert.Equal(2, await db.ReservationCancellationRequests.CountAsync());
    }

    [Fact]
    public async Task NotificationFailure_RollsBackRequestAndEarlierNotificationWrites()
    {
        await using var store = await Store.CreateAsync();
        await using (var db = store.Open())
        {
            var permissions = Permissions(db);
            var service = new ReservationCancellationRequestService(db, permissions,
                new ThrowAfterWriteNotificationService(db));
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                service.CreateAsync(1, "R-100001", Request()));
        }
        await using var verify = store.Open();
        Assert.Empty(await verify.ReservationCancellationRequests.ToListAsync());
        Assert.Empty(await verify.NotificationLogs.ToListAsync());
    }

    [Fact]
    public async Task InvalidAndCancelledRequests_WriteNoNotifications()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = Service(db);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.CreateAsync(1, "R-999999", Request()));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, "R-100001", new()));
        var reservation = await db.Reservations.SingleAsync();
        reservation.Status = ReservationStatus.Cancelled;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, "R-100001", Request()));
        Assert.Empty(await db.NotificationLogs.ToListAsync());
    }

    private static async Task AssertFinanceUnchanged(KoochDbContext db)
    {
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Empty(await db.Payments.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Empty(await db.FinancialEntries.ToListAsync());
    }

    private static CreateReservationCancellationRequest Request() => new()
    {
        Reason = ReservationCancellationReason.GuestRequest,
        Message = "Please cancel"
    };

    private static IPermissionService Permissions(KoochDbContext db) =>
        new PermissionService(db, new PropertyAccessService(db));

    private static ReservationCancellationRequestService Service(KoochDbContext db) =>
        new(db, Permissions(db), new NotificationService(db));

    private sealed class ThrowAfterWriteNotificationService(KoochDbContext db) : INotificationService
    {
        public async Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default)
        {
            await new NotificationService(db).SendAsync(request, cancellationToken);
            throw new InvalidOperationException("Injected notification failure.");
        }
    }

    private sealed class Store(string path) : IAsyncDisposable
    {
        public KoochDbContext Open() => new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Foreign Keys=False;Pooling=False").Options);

        public static async Task<Store> CreateAsync()
        {
            var store = new Store(Path.Combine(Path.GetTempPath(), $"kooch-cancel-notification-{Guid.NewGuid():N}.db"));
            await using var db = store.Open();
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(
                User(1, UserRole.Client), User(2, UserRole.SuperAdmin), User(3, UserRole.AdminAssistant),
                User(4, UserRole.AdminAssistant), User(5, UserRole.AdminAssistant),
                User(6, UserRole.AdminAssistant), User(7, UserRole.AdminAssistant, active: false),
                User(8, UserRole.AdminAssistant), User(9, UserRole.Client), User(10, UserRole.AdminAssistant));
            db.Properties.AddRange(
                new Property { Id = 20, OwnerId = 9, Name = "Main", Slug = "main" },
                new Property { Id = 21, OwnerId = 9, Name = "Other", Slug = "other" });
            db.RoomTypes.Add(new RoomType { Id = 31, PropertyId = 20, Name = "Room", Slug = "room" });
            db.Guests.Add(new Guest { Id = 32, UserId = 1, FirstName = "Guest" });
            db.Reservations.Add(new Reservation
            {
                Id = 30, PropertyId = 20, RoomTypeId = 31, ClientId = 1, GuestId = 32,
                ReservationNumber = "R-100001", Status = ReservationStatus.Confirmed,
                CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2)
            });
            foreach (var userId in new[] { 3, 5, 6, 7, 8, 10 })
                db.UserPermissions.Add(new UserPermission
                {
                    UserId = userId, PermissionKey = PermissionKey.ManageReservations, IsAllowed = true
                });
            db.UserPropertyAccesses.AddRange(
                Access(3, 20, view: true, cancel: true),
                Access(4, 20, view: true, cancel: true),
                Access(5, 20, view: true, cancel: false),
                Access(6, 20, view: false, cancel: true),
                Access(7, 20, view: true, cancel: true),
                Access(8, 21, view: true, cancel: true),
                Access(9, 20, view: true, cancel: true, owner: true),
                Access(10, 20, view: true, cancel: true));
            await db.SaveChangesAsync();
            return store;
        }

        public ValueTask DisposeAsync()
        {
            File.Delete(path);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<Reservation>().Property(item => item.RowVersion).ValueGeneratedNever();
        }
    }

    private static User User(int id, UserRole role, bool active = true) => new()
    {
        Id = id, FirstName = $"User{id}", LastName = "Test", Role = role, IsActive = active
    };

    private static UserPropertyAccess Access(int userId, int propertyId, bool view, bool cancel, bool owner = false) => new()
    {
        UserId = userId, PropertyId = propertyId,
        PropertyRole = owner ? PropertyUserRole.PropertyOwner : PropertyUserRole.Manager,
        Status = PropertyUserStatus.Active, IsActive = true,
        PermissionMatrixJson = JsonSerializer.Serialize(new
        {
            Bookings = new { View = view, Delete = cancel }
        })
    };
}
