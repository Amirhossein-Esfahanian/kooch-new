using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyVisitTests
{
    private const string Session = "some-opaque-browser-session-identifier-12345";
    private static readonly ClaimsPrincipal Anonymous = new(new ClaimsIdentity());

    [Fact]
    public async Task FirstVisitIsStoredAsHashAndSameDayReplayIsIdempotent()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.RecordAsync("approved-one", Session, Anonymous, "Mozilla/5.0");
        await fixture.Service.RecordAsync("approved-one", Session, Anonymous, "Mozilla/5.0");

        var visit = Assert.Single(await fixture.Context.PropertyVisits.AsNoTracking().ToListAsync());
        Assert.Equal(1, visit.PropertyId);
        Assert.Equal(new DateOnly(2026, 10, 21), visit.BusinessDate);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"1:2026-10-21:{Session}"))), visit.SessionHash);
        Assert.DoesNotContain(Session, visit.SessionHash);
        Assert.DoesNotContain(typeof(PropertyVisit).GetProperties(), property =>
            property.Name.Contains("Ip", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("UserAgent", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("SessionId", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task PropertyAndTehranBusinessDateAreSeparateDeduplicationScopes()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.RecordAsync("approved-one", Session, Anonymous, null);
        await fixture.Service.RecordAsync("approved-two", Session, Anonymous, null);
        fixture.Clock.Now = new DateTimeOffset(2026, 10, 21, 20, 45, 0, TimeSpan.Zero);
        await fixture.Service.RecordAsync("approved-one", Session, Anonymous, null);

        var visits = await fixture.Context.PropertyVisits.AsNoTracking().ToListAsync();
        Assert.Equal(3, visits.Count);
        Assert.Contains(visits, visit => visit.PropertyId == 1 && visit.BusinessDate == new DateOnly(2026, 10, 22));
        Assert.Equal(3, visits.Select(visit => visit.SessionHash).Distinct().Count());
    }

    [Fact]
    public async Task RejectsUnapprovedPropertyAndInvalidIdentifier()
    {
        await using var fixture = await Fixture.CreateAsync();
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            fixture.Service.RecordAsync("draft", Session, Anonymous, null));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.RecordAsync("approved-one", "short", Anonymous, null));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.RecordAsync("approved-one", new string('a', 31) + "!", Anonymous, null));
        Assert.Empty(fixture.Context.PropertyVisits);
    }

    [Fact]
    public async Task KnownBotsAndVerifiedManagementViewsAreNotRecorded()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.RecordAsync("approved-one", Session, Anonymous, "Googlebot/2.1");
        await fixture.Service.RecordAsync("approved-one", Session, Principal(10), "Mozilla/5.0");
        await fixture.Service.RecordAsync("approved-one", Session, Principal(20), "Mozilla/5.0");
        await fixture.Service.RecordAsync("approved-one", Session, Principal(30), "Mozilla/5.0");
        Assert.Empty(fixture.Context.PropertyVisits);
        await fixture.Service.RecordAsync("approved-one", Session, Principal(40), "Mozilla/5.0");
        Assert.Single(fixture.Context.PropertyVisits);
    }

    [Fact]
    public async Task ConcurrentDuplicateRequestsLeaveOneVisit()
    {
        await using var fixture = await Fixture.CreateAsync();
        await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            await using var connection = new SqliteConnection(fixture.ConnectionString);
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            await using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).Options);
            await new PropertyVisitService(context, fixture.Clock)
                .RecordAsync("approved-one", Session, Anonymous, null);
        }));
        Assert.Single(await fixture.Context.PropertyVisits.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task EndpointIsPublicPostWithRateLimitAndNoVisitorIdentifierResponse()
    {
        await using var fixture = await Fixture.CreateAsync();
        var controller = new PublicPropertyVisitsController(fixture.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        Assert.IsType<NoContentResult>(await controller.Record(
            "approved-one", new RecordPropertyVisitRequest { SessionId = Session }, default));
        var type = typeof(PublicPropertyVisitsController);
        Assert.Single(type.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));
        Assert.Equal("api/properties/{slug}/visits",
            Assert.IsType<RouteAttribute>(Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true))).Template);
        var method = type.GetMethod(nameof(PublicPropertyVisitsController.Record))!;
        Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true));
        Assert.Equal(PropertyVisitRateLimitPolicy.Name,
            Assert.IsType<EnableRateLimitingAttribute>(Assert.Single(
                method.GetCustomAttributes(typeof(EnableRateLimitingAttribute), true))).PolicyName);
        Assert.DoesNotContain(typeof(PropertyVisit).GetProperties(), property =>
            property.PropertyType == typeof(System.Net.IPAddress));
    }

    private static ClaimsPrincipal Principal(int userId) => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test"));

    private sealed class FixedClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Fixture(SqliteConnection connection, KoochDbContext context, FixedClock clock)
        : IAsyncDisposable
    {
        public string ConnectionString { get; } = connection.ConnectionString;
        public KoochDbContext Context { get; } = context;
        public FixedClock Clock { get; } = clock;
        public PropertyVisitService Service { get; } = new(context, clock);

        public static async Task<Fixture> CreateAsync()
        {
            var connection = new SqliteConnection(
                $"Data Source=property-visits-{Guid.NewGuid():N};Mode=Memory;Cache=Shared;Foreign Keys=False;Default Timeout=30");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            context.Properties.AddRange(
                new Property { Id = 1, Slug = "approved-one", Status = PropertyStatus.Approved, OwnerId = 10 },
                new Property { Id = 2, Slug = "approved-two", Status = PropertyStatus.Approved, OwnerId = 11 },
                new Property { Id = 3, Slug = "draft", Status = PropertyStatus.Draft, OwnerId = 12 });
            context.Users.AddRange(
                new User { Id = 10, Role = UserRole.Client, IsActive = true },
                new User { Id = 20, Role = UserRole.SuperAdmin, IsActive = true },
                new User { Id = 30, Role = UserRole.Client, IsActive = true },
                new User { Id = 40, Role = UserRole.Client, IsActive = true });
            context.UserPropertyAccesses.Add(new UserPropertyAccess
            {
                UserId = 30, PropertyId = 1, IsActive = true, Status = PropertyUserStatus.Active
            });
            await context.SaveChangesAsync();
            return new Fixture(connection, context, new FixedClock());
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
