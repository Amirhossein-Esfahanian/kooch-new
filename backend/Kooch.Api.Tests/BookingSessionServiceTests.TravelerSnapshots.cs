using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Fact]
    public async Task SelfBookingWithoutGuest_FreshRequestReplayPreservesCapturedSnapshot()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Remove(await setup.Guests.SingleAsync());
            await setup.SaveChangesAsync();
        }
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        BookingSessionCreateResult first;
        await using (var scope = harness.CreateService())
            first = await scope.Service.CreateForAccountAsync(1, request);
        await using (var retry = harness.CreateService())
            Assert.Equal(first.BookingSessionId,
                (await retry.Service.CreateForAccountAsync(1, request)).BookingSessionId);
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest { FirstName = "Different" };
        await using (var changed = harness.CreateService())
            await Assert.ThrowsAsync<InvalidOperationException>(() => changed.Service.CreateForAccountAsync(1, request));
        await using var verify = harness.CreateContext();
        Assert.Single(await verify.Guests.ToListAsync());
        Assert.Single(await verify.Reservations.ToListAsync());
        Assert.Equal("Booking", (await verify.BookingSessions.SingleAsync()).TravelerFirstNameSnapshot);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OtherTraveler_MatchingRegisteredIdentityNeverReadsAssociatesOrChangesGuest(bool emailOnly)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        string originalGuests;
        await using (var setup = harness.CreateContext())
        {
            setup.Users.Add(new User { Id = 2, FirstName = "Foreign", LastName = "User",
                PhoneNumber = "09123456789", Email = "foreign@example.test", IsActive = true });
            setup.WalletAccounts.Add(new WalletAccount { UserId = 2, Currency = "IRR" });
            setup.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
            {
                Title = "Active", Amount = 100, StartDate = DateOnly.MinValue, EndDate = DateOnly.MaxValue,
                MaxRecipients = 10, ValidityDays = 30, IsActive = true
            });
            setup.Guests.Add(new Guest { Id = 2, UserId = 2, FirstName = "Private", LastName = "Identity",
                Mobile = "09123456789", NormalizedMobile = "09123456789",
                Email = "foreign@example.test", NormalizedEmail = "foreign@example.test",
                NationalCode = "1234567891" });
            await setup.SaveChangesAsync();
            originalGuests = JsonSerializer.Serialize(await setup.Guests.AsNoTracking().OrderBy(g => g.Id)
                .Select(g => new { g.Id, g.UserId, g.FirstName, g.LastName, g.Mobile, g.Email, g.NationalCode }).ToArrayAsync());
        }
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(20, 200));
        request.PrimaryGuest!.Mobile = emailOnly ? null : "+98 912 345 6789";
        request.PrimaryGuest.Email = emailOnly ? " FOREIGN@EXAMPLE.TEST " : null;
        request.PrimaryGuest.NationalCode = " ۱۲۳۴۵۶۷۸۹۱ ";
        var before = DateTime.UtcNow;
        await using var scope = harness.CreateService();
        var result = await scope.Service.CreateForAccountAsync(1, request);
        await using var verify = harness.CreateContext();
        Assert.Null(result.GuestId);
        var session = await verify.BookingSessions.Include(s => s.Reservations).SingleAsync();
        Assert.Null(session.GuestId);
        Assert.Equal((byte)2, session.TravelerSnapshotKind);
        Assert.Equal("Niloofar", session.TravelerFirstNameSnapshot);
        Assert.Equal("Traveler", session.TravelerLastNameSnapshot);
        Assert.Equal("1234567891", session.TravelerNationalCodeSnapshot);
        Assert.Equal(emailOnly ? null : "09123456789", session.TravelerMobileSnapshot);
        Assert.Equal(emailOnly ? "foreign@example.test" : null, session.TravelerEmailSnapshot);
        Assert.InRange(session.TravelerSnapshotCapturedAtUtc!.Value, before, DateTime.UtcNow);
        Assert.Equal(2, session.Reservations.Count);
        Assert.All(session.Reservations, r =>
        {
            Assert.Null(r.GuestId);
            Assert.Equal(1, r.ClientId);
            Assert.Equal(session.TravelerSnapshotKind, r.TravelerSnapshotKind);
            Assert.Equal(session.TravelerFirstNameSnapshot, r.TravelerFirstNameSnapshot);
            Assert.Equal(session.TravelerLastNameSnapshot, r.TravelerLastNameSnapshot);
            Assert.Equal(session.TravelerMobileSnapshot, r.TravelerMobileSnapshot);
            Assert.Equal(session.TravelerEmailSnapshot, r.TravelerEmailSnapshot);
            Assert.Equal(session.TravelerNationalCodeSnapshot, r.TravelerNationalCodeSnapshot);
            Assert.Equal(session.TravelerSnapshotCapturedAtUtc, r.TravelerSnapshotCapturedAtUtc);
        });
        Assert.Equal(originalGuests, JsonSerializer.Serialize(await verify.Guests.AsNoTracking().OrderBy(g => g.Id)
            .Select(g => new { g.Id, g.UserId, g.FirstName, g.LastName, g.Mobile, g.Email, g.NationalCode }).ToArrayAsync()));
        Assert.Equal(2, (await verify.WalletAccounts.SingleAsync()).UserId);
        Assert.Empty(await verify.WalletEntries.ToListAsync());
        Assert.Empty(await verify.WelcomeGiftGrants.ToListAsync());
        Assert.Equal(0, (await verify.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            new BookingSessionQueryService(verify).GetBySessionCodeForClientAsync(2, result.SessionCode));
    }

    [Fact]
    public async Task SelfSnapshot_SurvivesGuestChangesAndFreshRequestReplay()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        BookingSessionCreateResult first;
        await using (var scope = harness.CreateService())
            first = await scope.Service.CreateForAccountAsync(1, request);
        DateTime? capturedAt;
        await using (var setup = harness.CreateContext())
        {
            var session = await setup.BookingSessions.SingleAsync();
            Assert.Equal((byte)1, session.TravelerSnapshotKind);
            Assert.Equal("Booking", session.TravelerFirstNameSnapshot);
            Assert.Equal("Guest", session.TravelerLastNameSnapshot);
            Assert.Null(session.TravelerMobileSnapshot);
            Assert.Null(session.TravelerEmailSnapshot);
            Assert.Null(session.TravelerNationalCodeSnapshot);
            capturedAt = session.TravelerSnapshotCapturedAtUtc;
            var guest = await setup.Guests.SingleAsync();
            guest.FirstName = "Changed";
            guest.Email = "changed@example.test";
            await setup.SaveChangesAsync();
        }
        await using (var retry = harness.CreateService())
            Assert.Equal(first.BookingSessionId,
                (await retry.Service.CreateForAccountAsync(1, request)).BookingSessionId);
        await using var verify = harness.CreateContext();
        var saved = await verify.BookingSessions.SingleAsync();
        Assert.Equal(1, saved.GuestId);
        Assert.Equal("Booking", saved.TravelerFirstNameSnapshot);
        Assert.Null(saved.TravelerEmailSnapshot);
        Assert.Equal(capturedAt, saved.TravelerSnapshotCapturedAtUtc);
        Assert.Equal("Booking", (await verify.Reservations.SingleAsync()).TravelerFirstNameSnapshot);
        Assert.Single(await verify.Guests.ToListAsync());
        Assert.Empty(await verify.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await verify.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task HistoricalOtherTravelerReplay_DoesNotBackfillOrChangeGuestAssociation()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        await using (var scope = harness.CreateService())
            await scope.Service.CreateForAccountAsync(1, request);
        await using (var setup = harness.CreateContext())
        {
            var session = await setup.BookingSessions.SingleAsync();
            session.GuestId = 1;
            session.TravelerSnapshotKind = null;
            session.TravelerFirstNameSnapshot = session.TravelerLastNameSnapshot = session.TravelerMobileSnapshot = null;
            session.TravelerSnapshotCapturedAtUtc = null;
            var reservation = await setup.Reservations.SingleAsync();
            reservation.GuestId = 1;
            reservation.TravelerSnapshotKind = null;
            reservation.TravelerFirstNameSnapshot = reservation.TravelerLastNameSnapshot = reservation.TravelerMobileSnapshot = null;
            reservation.TravelerSnapshotCapturedAtUtc = null;
            await setup.SaveChangesAsync();
        }
        await using (var retry = harness.CreateService())
            Assert.Equal(1, (await retry.Service.CreateForAccountAsync(1, request)).GuestId);
        await using var verify = harness.CreateContext();
        Assert.Null((await verify.BookingSessions.SingleAsync()).TravelerSnapshotKind);
        Assert.Null((await verify.Reservations.SingleAsync()).TravelerSnapshotCapturedAtUtc);
        Assert.Single(await verify.Reservations.ToListAsync());
    }

    [Fact]
    public async Task SQLite_FailureAfterSnapshotPersistenceRollsBackAndFreshRetrySucceeds()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using (var seed = new TravelerSqliteContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            await using var source = await BookingSessionTestHarness.CreateAsync();
            await using var sourceDb = source.CreateContext();
            seed.AddRange(await sourceDb.Users.AsNoTracking().ToListAsync());
            seed.AddRange(await sourceDb.Guests.AsNoTracking().ToListAsync());
            seed.AddRange(await sourceDb.Properties.AsNoTracking().ToListAsync());
            seed.AddRange(await sourceDb.RoomTypes.AsNoTracking().ToListAsync());
            seed.AddRange(await sourceDb.Rooms.AsNoTracking().ToListAsync());
            seed.AddRange(await sourceDb.SiteSettings.AsNoTracking().ToListAsync());
            await seed.SaveChangesAsync();
        }
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(20, 200));
        await using (var failing = new TravelerSqliteContext(options))
        {
            var service = TravelerSqliteService(failing, failAfterPersist: true);
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateForAccountAsync(1, request));
            Assert.Equal("Injected after activity persistence", error.Message);
        }
        await using (var verify = new TravelerSqliteContext(options))
        {
            Assert.Empty(await verify.BookingSessions.ToListAsync());
            Assert.Empty(await verify.Reservations.ToListAsync());
            Assert.Empty(await verify.ReservationActivities.ToListAsync());
            Assert.Single(await verify.Guests.ToListAsync());
            Assert.Empty(await verify.WalletEntries.ToListAsync());
            Assert.Empty(await verify.WelcomeGiftGrants.ToListAsync());
        }
        await using (var retry = new TravelerSqliteContext(options))
            await TravelerSqliteService(retry, false).CreateForAccountAsync(1, request);
        await using var final = new TravelerSqliteContext(options);
        Assert.Single(await final.BookingSessions.ToListAsync());
        Assert.Equal(2, await final.Reservations.CountAsync());
    }

    private static BookingSessionService TravelerSqliteService(TravelerSqliteContext db, bool failAfterPersist)
    {
        db.FailAfterActivitySave = failAfterPersist;
        return new(db, new EffectiveAvailabilityService(db), new TestReservationPricingService(),
            new ReservationStatusWorkflow(), new ReservationNumberGenerator(db),
            new BookingSessionCodeGenerator(db), new RecordingReservationNotificationDispatcher(),
            new PropertySameNightBookingPolicyService(TimeProvider.System),
            new ReservationActivityService(db, new StubPermissionService(true)));
    }

    private sealed class TravelerSqliteContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        public bool FailAfterActivitySave { get; set; }

        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            var result = await base.SaveChangesAsync(cancellationToken);
            if (FailAfterActivitySave && ChangeTracker.Entries<ReservationActivity>().Any())
                throw new InvalidOperationException("Injected after activity persistence");
            return result;
        }

        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<BookingSession>().Property(s => s.RowVersion).ValueGeneratedNever();
            builder.Entity<Reservation>().Property(r => r.RowVersion).ValueGeneratedNever();
        }
    }
}
