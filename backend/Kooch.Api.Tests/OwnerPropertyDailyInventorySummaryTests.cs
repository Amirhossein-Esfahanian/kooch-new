using System.Data.Common;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class OwnerPropertyDailyInventorySummaryTests
{
    private static readonly DateOnly Today = new(2026, 11, 1);

    [Fact]
    public async Task AggregatesOnlyActivePropertyTypesAndSeparatesCalendarModes()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 10); // No daily row and no prices: default capacity still applies.
        fixture.RoomType(11, 1, 8);
        fixture.RoomType(12, 1, 6);
        fixture.RoomType(13, 1, 5);
        fixture.RoomType(14, 1, 100, active: false);
        fixture.RoomType(20, 2, 200);
        fixture.Day(11, 4, AvailabilityStatus.OnRequest);
        fixture.Day(12, 2, AvailabilityStatus.Unavailable);
        fixture.Day(13, 3, AvailabilityStatus.Available, closed: true);
        fixture.Reservation(10, ReservationStatus.Confirmed);
        fixture.Reservation(11, ReservationStatus.ApprovedAwaitingPayment);
        fixture.Reservation(11, ReservationStatus.PendingApproval);
        fixture.Reservation(12, ReservationStatus.Paid);
        fixture.Reservation(13, ReservationStatus.Confirmed);
        fixture.Reservation(14, ReservationStatus.Confirmed);
        fixture.Reservation(20, ReservationStatus.Confirmed, propertyId: 2);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(1, response.PropertyId);
        Assert.Equal(Today, response.BusinessDate);
        Assert.Equal(19, response.ConfiguredUnits);
        Assert.Equal(14, response.EligibleConfiguredUnits);
        Assert.Equal(4, response.ReservedAllocatedUnits);
        Assert.Equal(12, response.RemainingUnits);
        Assert.Equal(9, response.AvailableModeRemainingUnits);
        Assert.Equal(3, response.OnRequestRemainingUnits);
        Assert.Equal(2, response.BlockedRoomTypeCount);
    }

    [Theory]
    [InlineData(0, AvailabilityStatus.Available, false, 0)]
    [InlineData(3, AvailabilityStatus.Available, false, 0)]
    [InlineData(3, AvailabilityStatus.OnRequest, false, 0)]
    [InlineData(0, AvailabilityStatus.Unavailable, false, 1)]
    [InlineData(3, AvailabilityStatus.Unavailable, false, 1)]
    [InlineData(3, AvailabilityStatus.Available, true, 1)]
    [InlineData(3, AvailabilityStatus.OnRequest, true, 1)]
    public async Task DailyOverrideAndClosureUseConfiguredStatus(
        int capacity, AvailabilityStatus status, bool closed, int blocked)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 10);
        fixture.Day(10, capacity, status, closed);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        var eligible = blocked == 0 ? capacity : 0;
        Assert.Equal(capacity, response.ConfiguredUnits);
        Assert.Equal(eligible, response.EligibleConfiguredUnits);
        Assert.Equal(0, response.ReservedAllocatedUnits);
        Assert.Equal(eligible, response.RemainingUnits);
        Assert.Equal(status == AvailabilityStatus.Available ? eligible : 0, response.AvailableModeRemainingUnits);
        Assert.Equal(status == AvailabilityStatus.OnRequest ? eligible : 0, response.OnRequestRemainingUnits);
        Assert.Equal(blocked, response.BlockedRoomTypeCount);
    }

    [Theory]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment, 1)]
    [InlineData(ReservationStatus.Confirmed, 1)]
    [InlineData(ReservationStatus.Paid, 1)]
    [InlineData(ReservationStatus.Pending, 0)]
    [InlineData(ReservationStatus.PendingApproval, 0)]
    [InlineData(ReservationStatusNormalizer.LegacyPendingApproval, 0)]
    [InlineData(ReservationStatus.Draft, 0)]
    [InlineData(ReservationStatus.Completed, 0)]
    [InlineData(ReservationStatus.Cancelled, 0)]
    [InlineData(ReservationStatus.Rejected, 0)]
    [InlineData(ReservationStatus.PaymentExpired, 0)]
    [InlineData(ReservationStatusNormalizer.LegacyPaymentExpired, 0)]
    [InlineData(ReservationStatus.CapacityLost, 0)]
    public async Task ReservationClaimsFollowEffectiveAvailabilityWithoutExpiringHolds(
        ReservationStatus status, int expected)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 2);
        fixture.Day(10, 2, AvailabilityStatus.OnRequest);
        var reservation = fixture.Reservation(10, status);
        reservation.PaymentExpiresAtUtc = fixture.Clock.GetUtcNow().UtcDateTime.AddHours(-1);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(expected, response.ReservedAllocatedUnits);
        Assert.Equal(2 - expected, response.RemainingUnits);
        Assert.Equal(2 - expected, response.OnRequestRemainingUnits);
        Assert.Equal(status, reservation.Status);
    }

    [Fact]
    public async Task ArrivalsConsumeTonightAndDeparturesDoNot()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 10);
        fixture.Reservation(10, ReservationStatus.Paid, Today, Today.AddDays(1));
        fixture.Reservation(10, ReservationStatus.Confirmed, Today.AddDays(-2), Today.AddDays(2));
        fixture.Reservation(10, ReservationStatus.Paid, Today.AddDays(-1), Today);
        fixture.Reservation(10, ReservationStatus.Paid, Today.AddDays(1), Today.AddDays(2));
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(2, response.ReservedAllocatedUnits);
        Assert.Equal(8, response.RemainingUnits);
    }

    [Fact]
    public async Task OverAllocationIsNotClampedAndDoesNotBecomeAConfiguredClosure()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 1);
        fixture.Reservation(10, ReservationStatus.Confirmed);
        fixture.Reservation(10, ReservationStatus.Paid);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(1, response.ConfiguredUnits);
        Assert.Equal(1, response.EligibleConfiguredUnits);
        Assert.Equal(2, response.ReservedAllocatedUnits);
        Assert.Equal(0, response.RemainingUnits);
        Assert.Equal(0, response.BlockedRoomTypeCount);
    }

    [Fact]
    public async Task MixedLegacyNamedAndPooledTypesUseReservationQuotasNotPhysicalRoomCounts()
    {
        await using var fixture = await Fixture.CreateAsync();
        var legacy = fixture.RoomType(10, 1, 4);
        legacy.InventoryMode = InventoryMode.NamedRooms;
        fixture.RoomType(11, 1, 3);
        fixture.Context.Rooms.Add(new Room { Id = 100, RoomTypeId = 10, Name = "Only named room", IsActive = true });
        fixture.Reservation(10, ReservationStatus.Confirmed).RoomId = 100;
        fixture.Reservation(11, ReservationStatus.Paid);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(7, response.ConfiguredUnits);
        Assert.Equal(2, response.ReservedAllocatedUnits);
        Assert.Equal(5, response.RemainingUnits);
        Assert.Empty(fixture.Context.RoomDailyPrices);
    }

    [Theory]
    [InlineData(20, 29, 59, 2026, 10, 31)]
    [InlineData(20, 30, 0, 2026, 11, 1)]
    public async Task UsesExactTehranMidnightBoundary(int hour, int minute, int second, int year, int month, int day)
    {
        await using var fixture = await Fixture.CreateAsync(new DateTimeOffset(2026, 10, 31, hour, minute, second, TimeSpan.Zero));
        fixture.RoomType(10, 1, 10);
        fixture.Day(10, 3, AvailabilityStatus.Available, date: Today.AddDays(-1));
        fixture.Day(10, 7, AvailabilityStatus.Available, date: Today);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(new DateOnly(year, month, day), response.BusinessDate);
        Assert.Equal(day == 1 ? 7 : 3, response.ConfiguredUnits);
    }

    [Fact]
    public async Task NoActiveRoomTypesReturnsKnownZerosWithoutWriting()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 99, active: false);
        fixture.RoomType(20, 2, 99);
        await fixture.Context.SaveChangesAsync();
        fixture.Context.ChangeTracker.Clear();
        fixture.ReadGuard.Enabled = true;

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(Today, response.BusinessDate);
        Assert.Equal(0, response.ConfiguredUnits);
        Assert.Equal(0, response.EligibleConfiguredUnits);
        Assert.Equal(0, response.ReservedAllocatedUnits);
        Assert.Equal(0, response.RemainingUnits);
        Assert.Equal(0, response.AvailableModeRemainingUnits);
        Assert.Equal(0, response.OnRequestRemainingUnits);
        Assert.Equal(0, response.BlockedRoomTypeCount);
        Assert.Empty(fixture.Context.ChangeTracker.Entries());
        Assert.Single(fixture.ReadGuard.Queries);
    }

    [Fact]
    public async Task PopulatedReadUsesOnlyPropertyDayQueriesAndLeavesStoredInventoryUntouched()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 10);
        fixture.Day(10, 7, AvailabilityStatus.OnRequest);
        fixture.Reservation(10, ReservationStatus.Paid);
        await fixture.Context.SaveChangesAsync();
        fixture.Context.ChangeTracker.Clear();
        fixture.ReadGuard.Enabled = true;

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(6, response.RemainingUnits);
        Assert.Empty(fixture.Context.ChangeTracker.Entries());
        Assert.Equal(4, fixture.ReadGuard.Queries.Count);
        Assert.DoesNotContain(fixture.ReadGuard.Queries, query => query.Contains("RoomDailyPrices"));
        fixture.ReadGuard.Enabled = false;
        Assert.Equal(7, (await fixture.Context.Availabilities.SingleAsync()).AvailableCount);
        Assert.Equal(ReservationStatus.Paid, (await fixture.Context.Reservations.SingleAsync()).Status);
        Assert.Empty(fixture.Context.AuditLogs);
    }

    [Fact]
    public async Task EndpointEnforcesActualReportsPermissionMembershipAndPropertyScope()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 2);
        fixture.RoomType(20, 2, 50);
        fixture.Context.Users.Add(new User { Id = 7, Role = UserRole.Client, IsActive = true });
        var membership = new UserPropertyAccess
        {
            UserId = 7, PropertyId = 1, IsActive = true, Status = PropertyUserStatus.Active,
            PropertyRole = PropertyUserRole.Manager,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
            {
                ["Reports"] = new PermissionActionsDto { View = true }
            })
        };
        fixture.Context.UserPropertyAccesses.Add(membership);
        await fixture.Context.SaveChangesAsync();
        var controller = fixture.Controller(7, UserRole.Client);

        var response = Assert.IsType<OwnerPropertyDailyInventorySummaryResponse>(
            Assert.IsType<OkObjectResult>((await controller.Get(1, default)).Result).Value);
        Assert.Equal(2, response.ConfiguredUnits);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(2, default));
        membership.Status = PropertyUserStatus.Suspended;
        await fixture.Context.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(1, default));
        membership.Status = PropertyUserStatus.Active;
        membership.IsActive = false;
        await fixture.Context.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(1, default));
        membership.IsActive = true;
        membership.PermissionMatrixJson = "{}";
        await fixture.Context.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(1, default));
    }

    [Fact]
    public async Task ExistingSuperAdminAccessIsPreservedAndEndpointIsOwnerReadOnly()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.RoomType(10, 1, 2);
        fixture.Context.Users.Add(new User { Id = 8, Role = UserRole.SuperAdmin, IsActive = true });
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Controller(8, UserRole.SuperAdmin).Get(1, default);
        Assert.IsType<OkObjectResult>(response.Result);
        var type = typeof(OwnerPropertyDailyInventorySummaryController);
        Assert.Single(type.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), true));
        Assert.Equal("api/owner/properties/{propertyId:int}/inventory/today-summary",
            Assert.IsType<RouteAttribute>(Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true))).Template);
        var method = type.GetMethod(nameof(OwnerPropertyDailyInventorySummaryController.Get))!;
        Assert.Single(method.GetCustomAttributes(typeof(HttpGetAttribute), true));
        Assert.Single(type.GetMethods(), candidate => candidate.DeclaringType == type);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class ReadOnlyCommandGuard : DbCommandInterceptor
    {
        public bool Enabled { get; set; }
        public List<string> Queries { get; } = [];

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (Enabled)
            {
                Assert.StartsWith("SELECT", command.CommandText.TrimStart(), StringComparison.OrdinalIgnoreCase);
                Queries.Add(command.CommandText);
            }
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Assert.False(Enabled, "The summary must not execute database writes.");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Fixture(SqliteConnection connection, SummaryContext context, FixedClock clock, ReadOnlyCommandGuard guard)
        : IAsyncDisposable
    {
        private int nextReservationId = 1;
        public SummaryContext Context { get; } = context;
        public FixedClock Clock { get; } = clock;
        public ReadOnlyCommandGuard ReadGuard { get; } = guard;
        public OwnerPropertyDailyInventorySummaryService Service { get; } = new(context, new EffectiveAvailabilityService(context), clock);

        public static async Task<Fixture> CreateAsync(DateTimeOffset? now = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var guard = new ReadOnlyCommandGuard();
            var context = new SummaryContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).AddInterceptors(guard).Options);
            await context.Database.EnsureCreatedAsync();
            context.Properties.AddRange(
                new Property { Id = 1, Slug = "one", Status = PropertyStatus.Approved },
                new Property { Id = 2, Slug = "two", Status = PropertyStatus.Approved });
            await context.SaveChangesAsync();
            return new Fixture(connection, context, new FixedClock(now ??
                new DateTimeOffset(2026, 11, 1, 9, 0, 0, TimeSpan.Zero)), guard);
        }

        public RoomType RoomType(int id, int propertyId, int capacity, bool active = true)
        {
            var roomType = new RoomType
            {
                Id = id, PropertyId = propertyId, Name = $"Type {id}", Slug = $"type-{id}",
                TotalInventory = capacity, IsActive = active, InventoryMode = InventoryMode.TypeBasedInventory
            };
            Context.RoomTypes.Add(roomType);
            return roomType;
        }

        public void Day(int roomTypeId, int count, AvailabilityStatus status, bool closed = false, DateOnly? date = null) =>
            Context.Availabilities.Add(new Availability
            {
                RoomTypeId = roomTypeId, Date = date ?? Today, AvailableCount = count, Status = status, IsClosed = closed
            });

        public Reservation Reservation(int roomTypeId, ReservationStatus status,
            DateOnly? checkIn = null, DateOnly? checkOut = null, int propertyId = 1)
        {
            var id = nextReservationId++;
            var reservation = new Reservation
            {
                Id = id, PropertyId = propertyId, ClientId = 7, RoomTypeId = roomTypeId,
                Status = status, CheckInDate = checkIn ?? Today, CheckOutDate = checkOut ?? Today.AddDays(1),
                ReservationNumber = $"RS-{id}", Currency = "IRR"
            };
            Context.Reservations.Add(reservation);
            return reservation;
        }

        public OwnerPropertyDailyInventorySummaryController Controller(int userId, UserRole role)
        {
            var controller = new OwnerPropertyDailyInventorySummaryController(Service,
                new PermissionService(Context, new PropertyAccessService(Context)))
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
            };
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role.ToString())], "test"));
            return controller;
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class SummaryContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<Reservation>().Property(row => row.RowVersion).ValueGeneratedNever();
            modelBuilder.Entity<Availability>().Property(row => row.RowVersion).ValueGeneratedNever();
        }
    }
}
