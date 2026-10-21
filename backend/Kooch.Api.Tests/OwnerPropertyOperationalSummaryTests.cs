using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class OwnerPropertyOperationalSummaryTests
{
    private static readonly DateOnly Today = new(2026, 10, 21);

    [Fact]
    public async Task CountsNormalAndLegacyPendingApprovalOnlyWithinProperty()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Add(10, ReservationStatus.PendingApproval, Today, Today.AddDays(1));
        database.Add(10, ReservationStatusNormalizer.LegacyPendingApproval, Today, Today.AddDays(1));
        database.Add(10, ReservationStatus.ApprovedAwaitingPayment, Today, Today.AddDays(1));
        database.Add(20, ReservationStatus.PendingApproval, Today, Today.AddDays(1));
        await database.Context.SaveChangesAsync();

        var result = await database.Service.GetAsync(10);

        Assert.Equal(2, result.PendingApprovalCount);
        Assert.Equal(0, result.ScheduledArrivalsTodayCount);
        Assert.Equal(0, result.ScheduledDeparturesTodayCount);
        Assert.Equal(1, (await database.Service.GetAsync(20)).PendingApprovalCount);
    }

    [Fact]
    public async Task TehranLocalDateDeterminesConfirmedAndPaidArrivalsAndDepartures()
    {
        // 20:45 UTC is already the next calendar day in Tehran.
        await using var database = await TestDatabase.CreateAsync(
            new DateTimeOffset(2026, 10, 20, 20, 45, 0, TimeSpan.Zero));
        database.Add(10, ReservationStatus.Confirmed, Today, Today.AddDays(2));
        database.Add(10, ReservationStatus.Paid, Today.AddDays(-2), Today);
        database.Add(10, ReservationStatus.Paid, Today, Today.AddDays(1));
        database.Add(10, ReservationStatus.Confirmed, Today.AddDays(-1), Today.AddDays(1));
        database.Add(20, ReservationStatus.Confirmed, Today, Today.AddDays(1));
        await database.Context.SaveChangesAsync();

        var result = await database.Service.GetAsync(10);

        Assert.Equal(Today, result.BusinessDate);
        Assert.Equal(2, result.ScheduledArrivalsTodayCount);
        Assert.Equal(1, result.ScheduledDeparturesTodayCount);
        Assert.Equal(0, result.PendingApprovalCount);
    }

    [Theory]
    [InlineData(ReservationStatus.Pending)]
    [InlineData(ReservationStatus.PendingApproval)]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Rejected)]
    [InlineData(ReservationStatus.PaymentExpired)]
    [InlineData(ReservationStatus.Completed)]
    public async Task UnconfirmedStatusesNeverCountAsScheduledArrivalsOrDepartures(ReservationStatus status)
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Add(10, status, Today, Today.AddDays(1));
        database.Add(10, status, Today.AddDays(-1), Today);
        await database.Context.SaveChangesAsync();

        var result = await database.Service.GetAsync(10);

        Assert.Equal(0, result.ScheduledArrivalsTodayCount);
        Assert.Equal(0, result.ScheduledDeparturesTodayCount);
    }

    [Fact]
    public async Task EndpointRequiresBookingsViewForRequestedPropertyAndScopesResponse()
    {
        await using var database = await TestDatabase.CreateAsync();
        database.Add(10, ReservationStatus.PendingApproval, Today, Today.AddDays(1));
        database.Add(20, ReservationStatus.PendingApproval, Today, Today.AddDays(1));
        database.Add(20, ReservationStatus.Confirmed, Today, Today.AddDays(1));
        await database.Context.SaveChangesAsync();
        var permissions = new TestPermissions(10);
        var controller = CreateController(database.Service, permissions);

        var response = await controller.Get(10, default);
        var summary = Assert.IsType<OwnerPropertyOperationalSummaryResponse>(
            Assert.IsType<OkObjectResult>(response.Result).Value);
        Assert.Equal(1, summary.PendingApprovalCount);
        Assert.Equal(0, summary.ScheduledArrivalsTodayCount);
        Assert.Equal((7, 10, "bookings.view"), permissions.LastCheck);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(20, default));
        Assert.Equal((7, 20, "bookings.view"), permissions.LastCheck);
    }

    [Fact]
    public async Task EndpointDeniesMissingPermissionAndIsOwnerReadOnlyRoute()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = CreateController(database.Service, new TestPermissions(null));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(10, default));
        var type = typeof(OwnerPropertyOperationalSummaryController);
        Assert.Single(type.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), true));
        Assert.Equal("api/owner/properties/{propertyId:int}/reservations/operational-summary",
            Assert.IsType<RouteAttribute>(Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true))).Template);
        Assert.Single(type.GetMethod(nameof(OwnerPropertyOperationalSummaryController.Get))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true));
        Assert.DoesNotContain(type.GetMethods(), method => method.DeclaringType == type &&
            (method.IsDefined(typeof(HttpPostAttribute), true) ||
             method.IsDefined(typeof(HttpPutAttribute), true) ||
             method.IsDefined(typeof(HttpDeleteAttribute), true)));
    }

    private static OwnerPropertyOperationalSummaryController CreateController(
        OwnerPropertyOperationalSummaryService service, IPermissionService permissions)
    {
        var controller = new OwnerPropertyOperationalSummaryController(service, permissions)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"),
             new Claim(ClaimTypes.Role, UserRole.Client.ToString())], "test"));
        return controller;
    }

    private sealed class TestPermissions(int? allowedPropertyId) : IPermissionService
    {
        public (int UserId, int PropertyId, string Key) LastCheck { get; private set; }

        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default)
        {
            LastCheck = (userId, propertyId, permissionKey);
            return Task.FromResult(propertyId == allowedPropertyId && permissionKey == "bookings.view");
        }

        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey,
            int? propertyId = null, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class TestDatabase(SqliteConnection connection, KoochDbContext context, FixedClock clock)
        : IAsyncDisposable
    {
        private int nextId = 1;
        public KoochDbContext Context { get; } = context;
        public OwnerPropertyOperationalSummaryService Service { get; } = new(context, clock);

        public static async Task<TestDatabase> CreateAsync(DateTimeOffset? now = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var context = new SummaryTestContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            return new TestDatabase(connection, context, new FixedClock(now ??
                new DateTimeOffset(2026, 10, 21, 9, 0, 0, TimeSpan.Zero)));
        }

        public void Add(int propertyId, ReservationStatus status, DateOnly checkIn, DateOnly checkOut)
        {
            Context.Reservations.Add(new Reservation
            {
                Id = nextId++, PropertyId = propertyId, ClientId = 1, RoomTypeId = 1,
                Status = status, CheckInDate = checkIn, CheckOutDate = checkOut,
                ReservationNumber = $"RS-{nextId}", Currency = "IRR"
            });
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class SummaryTestContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<Reservation>().Property(row => row.RowVersion).ValueGeneratedNever();
        }
    }
}
