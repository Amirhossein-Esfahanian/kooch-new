using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class OwnerPropertyVisitAnalyticsTests
{
    private static readonly DateOnly Today = new(2026, 10, 21);

    [Fact]
    public async Task CountsOnlyRequestedPropertyAndIncludesTodayInAllRollingPeriods()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Add(1, Today, 2);
        fixture.Add(1, Today.AddDays(-6));
        fixture.Add(1, Today.AddDays(-7));
        fixture.Add(1, Today.AddDays(-29));
        fixture.Add(1, Today.AddDays(-30));
        fixture.Add(1, Today.AddDays(-89));
        fixture.Add(1, Today.AddDays(-90));
        fixture.Add(2, Today, 3);
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(Today, response.BusinessDate);
        Assert.Equal(2, response.TodayRecordedVisits);
        Assert.Equal(3, response.Last7DaysTotal);
        Assert.Equal(5, response.Last30DaysTotal);
        Assert.Equal(7, response.Last90DaysTotal);
        Assert.Equal(90, response.DailyVisits.Count);
        Assert.Equal(Today.AddDays(-89), response.DailyVisits[0].BusinessDate);
        Assert.Equal(Today, response.DailyVisits[^1].BusinessDate);
        Assert.Equal(2, response.DailyVisits[^1].RecordedVisits);
        Assert.Equal(0, response.DailyVisits[1].RecordedVisits);
        Assert.Equal(3, (await fixture.Service.GetAsync(2)).TodayRecordedVisits);
    }

    [Fact]
    public async Task UsesTehranBusinessDateAtUtcBoundary()
    {
        await using var fixture = await Fixture.CreateAsync(
            new DateTimeOffset(2026, 10, 20, 20, 45, 0, TimeSpan.Zero));
        fixture.Add(1, Today);
        fixture.Add(1, Today.AddDays(-1));
        await fixture.Context.SaveChangesAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(Today, response.BusinessDate);
        Assert.Equal(1, response.TodayRecordedVisits);
        Assert.Equal(2, response.Last7DaysTotal);
    }

    [Fact]
    public async Task NoRecordedVisitsReturnsChronologicalZeroPointsWithoutClaimingCoverage()
    {
        await using var fixture = await Fixture.CreateAsync();

        var response = await fixture.Service.GetAsync(1);

        Assert.Equal(0, response.TodayRecordedVisits);
        Assert.Equal(0, response.Last7DaysTotal);
        Assert.Equal(0, response.Last30DaysTotal);
        Assert.Equal(0, response.Last90DaysTotal);
        Assert.Equal(90, response.DailyVisits.Count);
        Assert.All(response.DailyVisits, point => Assert.Equal(0, point.RecordedVisits));
        Assert.DoesNotContain(typeof(OwnerPropertyVisitAnalyticsResponse).GetProperties(), property =>
            property.Name.Contains("Session", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Visitor", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(typeof(PropertyVisitDailyCount).GetProperties(), property =>
            property.Name.Contains("Session", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Visitor", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task ReplayedSessionIsCountedOnce()
    {
        await using var fixture = await Fixture.CreateAsync();
        var visitor = new ClaimsPrincipal(new ClaimsIdentity());
        var ingestion = new PropertyVisitService(fixture.Context, fixture.Clock);
        const string session = "opaque-visitor-session-identifier-123456";
        await ingestion.RecordAsync("one", session, visitor, null);
        await ingestion.RecordAsync("one", session, visitor, null);

        Assert.Equal(1, (await fixture.Service.GetAsync(1)).TodayRecordedVisits);
    }

    [Fact]
    public async Task OwnerEndpointRequiresReportsViewForActivePropertyAccess()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Add(1, Today);
        fixture.Add(2, Today, 2);
        await fixture.Context.SaveChangesAsync();
        var permissions = new TestPermissions(1);
        var controller = new OwnerPropertyVisitAnalyticsController(fixture.Service, permissions)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"),
             new Claim(ClaimTypes.Role, UserRole.Client.ToString())], "test"));

        var allowed = await controller.Get(1, default);
        var response = Assert.IsType<OwnerPropertyVisitAnalyticsResponse>(
            Assert.IsType<OkObjectResult>(allowed.Result).Value);
        Assert.Equal(1, response.TodayRecordedVisits);
        Assert.Equal((7, 1, "reports.view"), permissions.LastCheck);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get(2, default));
        Assert.Equal((7, 2, "reports.view"), permissions.LastCheck);

        var type = typeof(OwnerPropertyVisitAnalyticsController);
        Assert.Single(type.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), true));
        Assert.Equal("api/owner/properties/{propertyId:int}/visits/analytics",
            Assert.IsType<RouteAttribute>(Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true))).Template);
        Assert.Single(type.GetMethod(nameof(OwnerPropertyVisitAnalyticsController.Get))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true));
    }

    [Fact]
    public async Task ActualPermissionServiceRequiresActiveMembershipAndReportsView()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Context.Users.Add(new User { Id = 7, Role = UserRole.Client, IsActive = true });
        var membership = new UserPropertyAccess
        {
            UserId = 7, PropertyId = 1, IsActive = true,
            Status = PropertyUserStatus.Active,
            PropertyRole = PropertyUserRole.Manager,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
            {
                ["Reports"] = new PermissionActionsDto { View = true }
            })
        };
        fixture.Context.UserPropertyAccesses.Add(membership);
        await fixture.Context.SaveChangesAsync();
        var access = new PropertyAccessService(fixture.Context);
        var permissions = new PermissionService(fixture.Context, access);

        Assert.True(await permissions.CanAsync(7, 1, "reports.view"));
        Assert.False(await permissions.CanAsync(7, 2, "reports.view"));
        membership.Status = PropertyUserStatus.Suspended;
        await fixture.Context.SaveChangesAsync();
        Assert.False(await permissions.CanAsync(7, 1, "reports.view"));
        membership.Status = PropertyUserStatus.Active;
        membership.PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
        {
            ["Reports"] = new PermissionActionsDto { View = false }
        });
        await fixture.Context.SaveChangesAsync();
        Assert.False(await permissions.CanAsync(7, 1, "reports.view"));
    }

    private sealed class TestPermissions(int? allowedPropertyId) : IPermissionService
    {
        public (int UserId, int PropertyId, string Key) LastCheck { get; private set; }

        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default)
        {
            LastCheck = (userId, propertyId, permissionKey);
            return Task.FromResult(propertyId == allowedPropertyId && permissionKey == "reports.view");
        }

        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey,
            int? propertyId = null, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class Fixture(SqliteConnection connection, KoochDbContext context, FixedClock clock)
        : IAsyncDisposable
    {
        private int nextId = 1;
        public KoochDbContext Context { get; } = context;
        public FixedClock Clock { get; } = clock;
        public OwnerPropertyVisitAnalyticsService Service { get; } = new(context, clock);

        public static async Task<Fixture> CreateAsync(DateTimeOffset? now = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            context.Properties.AddRange(
                new Property { Id = 1, Slug = "one", Status = PropertyStatus.Approved },
                new Property { Id = 2, Slug = "two", Status = PropertyStatus.Approved });
            await context.SaveChangesAsync();
            return new Fixture(connection, context, new FixedClock(now ??
                new DateTimeOffset(2026, 10, 21, 9, 0, 0, TimeSpan.Zero)));
        }

        public void Add(int propertyId, DateOnly date, int count = 1)
        {
            for (var index = 0; index < count; index++)
            {
                Context.PropertyVisits.Add(new PropertyVisit
                {
                    Id = nextId++, PropertyId = propertyId, BusinessDate = date,
                    SessionHash = $"{nextId:D64}", OccurredAtUtc = DateTime.UtcNow
                });
            }
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
