using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingCreationApprovalSqlServerTests(SqlServerWalletDatabase database)
    : IClassFixture<SqlServerWalletDatabase>
{
    [SqlServerWalletFact]
    public async Task DirectAttribution_ConcurrentDuplicates_PersistExactlyOneSessionAndPolicy()
    {
        var seed = await SeedAsync();
        await using var tokenDb = database.NewContext();
        var (request, tokens) = await DirectRequestAsync(seed, tokenDb);
        await using var first = database.NewContext();
        await using var second = database.NewContext();
        var results = await Task.WhenAll(
            DirectService(first, tokens, new RecordingReservationNotificationDispatcher()).CreateForAccountAsync(seed.Ids.OwnerId, request),
            DirectService(second, tokens, new RecordingReservationNotificationDispatcher()).CreateForAccountAsync(seed.Ids.OwnerId, request));
        Assert.Equal(results[0].BookingSessionId, results[1].BookingSessionId);
        await using var verify = database.NewContext();
        var session = Assert.Single(await verify.BookingSessions.Include(row => row.Reservations)
            .Where(row => row.PropertyId == seed.Ids.PropertyId).ToListAsync());
        Assert.Equal(CommissionType.PropertyReferralCode, session.CommissionType);
        Assert.Equal(CommissionType.PropertyReferralCode, Assert.Single(session.Reservations).CommissionType);
    }

    [SqlServerWalletFact]
    public async Task DirectAttribution_RevocationAfterIssuance_WaitsForPropertyLockThenDeniesWithoutWrites()
    {
        var seed = await SeedAsync();
        await using var tokenDb = database.NewContext();
        var (request, tokens) = await DirectRequestAsync(seed, tokenDb);
        await using var mutation = database.NewContext();
        await using var transaction = await mutation.Database.BeginTransactionAsync();
        await PropertyApprovalTestData.Images(mutation).DeleteAsync(seed.Ids.OwnerId, UserRole.Client, seed.Ids.ImageId);
        await using var booking = database.NewContext();
        var create = DirectService(booking, tokens, new RecordingReservationNotificationDispatcher())
            .CreateForAccountAsync(seed.Ids.OwnerId, request);
        await Task.Delay(200);
        Assert.False(create.IsCompleted);
        await transaction.CommitAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => create.WaitAsync(TimeSpan.FromSeconds(30)));
        await using var verify = database.NewContext();
        Assert.False(await verify.BookingSessions.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
        Assert.False(await verify.Reservations.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
    }

    [SqlServerWalletFact]
    public async Task DirectAttribution_FailureAfterSave_RollsBackSessionReservationsAndAudit()
    {
        var seed = await SeedAsync();
        await using var tokenDb = database.NewContext();
        var (request, tokens) = await DirectRequestAsync(seed, tokenDb);
        await using var booking = database.NewContext();
        var pause = new PausedNotifications();
        var create = DirectService(booking, tokens, pause).CreateForAccountAsync(seed.Ids.OwnerId, request);
        await Task.WhenAny(create, pause.Entered.Task).WaitAsync(TimeSpan.FromSeconds(30));
        if (create.IsCompleted) await create;
        pause.Release.TrySetException(new IOException("Injected notification failure after persistence."));
        await Assert.ThrowsAsync<IOException>(() => create.WaitAsync(TimeSpan.FromSeconds(30)));
        await using var verify = database.NewContext();
        Assert.False(await verify.BookingSessions.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
        Assert.False(await verify.Reservations.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
        Assert.False(await verify.ReservationActivities.AnyAsync(row => row.Reservation.PropertyId == seed.Ids.PropertyId));
    }

    private static async Task<(AccountBookingSessionCreateRequest Request, AttributionTokens Tokens)> DirectRequestAsync(Seed seed, KoochDbContext db)
    {
        var request = new AccountBookingSessionCreateRequest
        {
            IdempotencyKey = Guid.NewGuid().ToString("N"), Items = [new()
            {
                RoomTypeId = seed.Ids.RoomTypeId, CheckInDate = new(2035, 2, 1), CheckOutDate = new(2035, 2, 3), Adults = 1
            }]
        };
        var tokens = new AttributionTokens(db);
        var slug = await db.Properties.Where(row => row.Id == seed.Ids.PropertyId).Select(row => row.Slug).SingleAsync();
        await tokens.Attach(request, seed.Ids.OwnerId, slug);
        return (request, tokens);
    }

    private static BookingSessionService DirectService(KoochDbContext db, AttributionTokens tokens, IReservationNotificationDispatcher notifications) =>
        new(db, new EffectiveAvailabilityService(db), new StubReservationPricingService(),
            new ReservationStatusWorkflow(), new ReservationNumberGenerator(db), new BookingSessionCodeGenerator(db),
            notifications, new PropertySameNightBookingPolicyService(TimeProvider.System),
            new ReservationActivityService(db, new StubPermissionService(true)), tokens.Service);

    [SqlServerWalletFact]
    public async Task RevocationFirst_BlocksAllCreationPathsWithoutPartialWrites()
    {
        foreach (var kind in new[] { "account", "internal", "manual" })
        {
            var seed = await SeedAsync();
            await using var mutation = database.NewContext();
            await using var transaction = await mutation.Database.BeginTransactionAsync();
            await PropertyApprovalTestData.Images(mutation).DeleteAsync(seed.Ids.OwnerId, UserRole.Client, seed.Ids.ImageId);
            await using var booking = database.NewContext();
            var create = CreateAsync(booking, seed, kind, new RecordingReservationNotificationDispatcher());
            await Task.Delay(200);
            Assert.False(create.IsCompleted);
            await transaction.CommitAsync();
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => create.WaitAsync(TimeSpan.FromSeconds(30)));
            Assert.Equal("Only Approved Properties can accept new bookings.", error.Message);
            await using var verify = database.NewContext();
            Assert.False(await verify.BookingSessions.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
            Assert.False(await verify.Reservations.AnyAsync(row => row.PropertyId == seed.Ids.PropertyId));
            Assert.Equal(2, (await verify.RoomTypes.SingleAsync(row => row.Id == seed.Ids.RoomTypeId)).TotalInventory);
        }
    }

    [SqlServerWalletFact]
    public async Task CreationFirst_CommitsBeforeRevocation_ExistingBookingIsPreserved()
    {
        foreach (var kind in new[] { "account", "internal", "manual" })
        {
            var seed = await SeedAsync();
            await using var booking = database.NewContext();
            var pause = new PausedNotifications();
            var create = CreateAsync(booking, seed, kind, pause);
            await Task.WhenAny(create, pause.Entered.Task).WaitAsync(TimeSpan.FromSeconds(30));
            if (create.IsCompleted) await create;
            await using var mutation = database.NewContext();
            var revoke = PropertyApprovalTestData.Images(mutation).DeleteAsync(seed.Ids.OwnerId, UserRole.Client, seed.Ids.ImageId);
            try
            {
                await Task.Delay(200);
                Assert.False(revoke.IsCompleted);
            }
            finally { pause.Release.TrySetResult(); }
            await create.WaitAsync(TimeSpan.FromSeconds(30));
            await revoke.WaitAsync(TimeSpan.FromSeconds(30));
            await using var verify = database.NewContext();
            Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync(row => row.Id == seed.Ids.PropertyId)).Status);
            var reservation = Assert.Single(await verify.Reservations.Where(row => row.PropertyId == seed.Ids.PropertyId).ToListAsync());
            Assert.Equal(ReservationStatus.PendingApproval, reservation.Status);
            Assert.Equal(100m, reservation.FinalAmount);
            Assert.Null(reservation.PaidAtUtc);
            Assert.False(await verify.Payments.AnyAsync(row => row.ReservationId == reservation.Id));
        }
    }

    private async Task<Seed> SeedAsync()
    {
        await using var db = database.NewContext();
        var ids = await PropertyApprovalTestData.SeedAsync(db);
        var room = new Room { RoomTypeId = ids.RoomTypeId, Name = "Approval test room", IsActive = true };
        var guest = new Guest { FirstName = "Test", LastName = "Traveler" };
        if (!await db.SiteSettings.AnyAsync(row => row.Key == "reservation.ownerApprovalWindowMinutes"))
            db.SiteSettings.Add(new SiteSetting
            {
                Key = "reservation.ownerApprovalWindowMinutes", Value = "45", IsActive = true,
                Type = SiteSettingType.Number, Group = "Reservation", Label = "Approval window"
            });
        db.Rooms.Add(room);
        db.Guests.Add(guest);
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = ids.RoomTypeId, Date = new(2035, 2, 1), AvailableCount = 2, Status = AvailabilityStatus.OnRequest
        });
        await db.SaveChangesAsync();
        return new(ids, room.Id, guest.Id);
    }

    private static async Task CreateAsync(KoochDbContext db, Seed seed, string kind, IReservationNotificationDispatcher notifications)
    {
        var effective = new EffectiveAvailabilityService(db);
        if (kind == "manual")
        {
            var service = new ReservationService(db, new ReservationAvailabilityService(db, effective),
                new StubReservationPricingService(), new ReservationNumberGenerator(db), new RecordingNotificationService(),
                notifications, new RecordingAuditLogService(), new StubPermissionService(true),
                new StubPropertyAuthorizationService(true), new ReservationStatusWorkflow(), effective, new TestHostEnvironment());
            await service.CreateAsync(new ReservationCreateRequest
            {
                PropertyId = seed.Ids.PropertyId, RoomTypeId = seed.Ids.RoomTypeId, RoomId = seed.RoomId, GuestId = seed.GuestId,
                CheckInDate = new(2035, 2, 1), CheckOutDate = new(2035, 2, 3), Adults = 1
            }, (seed.Ids.AdminId, UserRole.SuperAdmin));
            return;
        }
        var sessions = new BookingSessionService(db, effective, new StubReservationPricingService(),
            new ReservationStatusWorkflow(), new ReservationNumberGenerator(db), new BookingSessionCodeGenerator(db),
            notifications, new PropertySameNightBookingPolicyService(TimeProvider.System),
            new ReservationActivityService(db, new StubPermissionService(true)));
        if (kind == "account")
            await sessions.CreateForAccountAsync(seed.Ids.OwnerId, new AccountBookingSessionCreateRequest
            {
                IdempotencyKey = Guid.NewGuid().ToString("N"), Items = [new()
                {
                    RoomTypeId = seed.Ids.RoomTypeId, CheckInDate = new(2035, 2, 1), CheckOutDate = new(2035, 2, 3), Adults = 1
                }]
            });
        else
            await sessions.CreateAsync(new BookingSessionCreateRequest
            {
                ClientId = seed.Ids.OwnerId, PropertyId = seed.Ids.PropertyId, Items = [new()
                {
                    RoomTypeId = seed.Ids.RoomTypeId, CheckInDate = new(2035, 2, 1), CheckOutDate = new(2035, 2, 3), Adults = 1
                }]
            });
    }

    private sealed record Seed(PropertyApprovalTestData.Ids Ids, int RoomId, int GuestId);

    private sealed class PausedNotifications : IReservationNotificationDispatcher
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task NotifyPendingApprovalAsync(IReadOnlyCollection<int> reservationIds, CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(cancellationToken);
        }
        public Task NotifyOwnerApprovalTimeoutAsync(int reservationId, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<bool> NotifyApprovalReminderAsync(int reservationId, DateTime nowUtc, string occurrenceKey,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}
