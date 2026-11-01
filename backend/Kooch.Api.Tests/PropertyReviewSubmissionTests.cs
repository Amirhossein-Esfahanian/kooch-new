using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Exceptions;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyReviewSubmissionTests
{
    [Theory]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.Rejected)]
    public async Task CompleteProperty_SubmitsWithActorAudit_AndAppearsInExistingReviewQueue(PropertyStatus status)
    {
        await using var fixture = await Fixture.CreateAsync(status);
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var controller = new OwnerPropertiesController(PropertyApprovalTestData.Service(db),
            new PropertyCompletionService(db, new PropertyAccessService(db)))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([
                    new Claim(ClaimTypes.NameIdentifier, ids.OwnerId.ToString()),
                    new Claim(ClaimTypes.Role, nameof(UserRole.Client))], "test"))
            } }
        };

        var result = Assert.IsType<PropertyResponse>(Assert.IsType<OkObjectResult>(
            (await controller.SubmitForReview(ids.PropertyId, default)).Result).Value);
        Assert.Equal(PropertyStatus.PendingReview, result.Status);
        var log = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal(ids.OwnerId, log.UserId);
        Assert.Equal(ids.PropertyId, log.PropertyId);
        Assert.Equal(AuditAction.PropertyInformationChanged, log.Action);
        Assert.Equal(status.ToString(), JsonDocument.Parse(log.PreviousValuesJson!).RootElement.GetProperty("Status").GetString());
        Assert.Equal("PendingReview", JsonDocument.Parse(log.NewValuesJson!).RootElement.GetProperty("Status").GetString());
        var dashboard = Assert.IsType<AdminDashboardResponse>(Assert.IsType<OkObjectResult>(
            (await new AdminDashboardController(db).Get(default)).Result).Value);
        Assert.Equal(1, dashboard.PendingProperties);
        Assert.Contains(dashboard.PendingPropertyItems, item => item.Id == ids.PropertyId);
        Assert.Equal(0, dashboard.ApprovedProperties);
        // Final approval remains the existing, separate Admin operation.
        Assert.Equal(PropertyStatus.Approved, (await PropertyApprovalTestData.Service(db)
            .ApprovePropertyAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId)).Status);
    }

    [Theory]
    [InlineData("name")]
    [InlineData("description")]
    [InlineData("location")]
    [InlineData("image")]
    [InlineData("time")]
    public async Task IncompleteProperty_IsRejectedWithAuthoritativeMissingItems(string gap)
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var property = await db.Properties.SingleAsync();
        switch (gap)
        {
            case "name": property.Name = ""; break;
            case "description": property.Description = ""; break;
            case "location": property.Address = ""; break;
            case "image": db.PropertyImages.Remove(await db.PropertyImages.SingleAsync()); break;
            case "time": property.CheckInTime = null; break;
        }
        await db.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<PropertyActivationException>(() => SubmitAsync(db, fixture.Ids));
        Assert.False(error.Completion.CanActivate);
        Assert.Contains(error.Completion.Sections, section => section.MissingItems.Count > 0);
        var context = ExceptionContext(error);
        new ApiExceptionFilter().OnException(context);
        var response = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(409, response.StatusCode);
        Assert.Contains("completion", JsonSerializer.Serialize(response.Value));
        await AssertUnchangedAsync(fixture);
    }

    [Theory]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Approved)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task InvalidStatus_IsConflictWithoutAudit(PropertyStatus status)
    {
        await using var fixture = await Fixture.CreateAsync(status);
        await using var db = fixture.NewContext();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => SubmitAsync(db, fixture.Ids));
        var context = ExceptionContext(error);
        new ApiExceptionFilter().OnException(context);
        Assert.Equal(409, Assert.IsType<ObjectResult>(context.Result).StatusCode);
        await AssertUnchangedAsync(fixture, status);
    }

    [Fact]
    public async Task DuplicateSubmission_IsConflictAndDoesNotDuplicateAudit()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var first = fixture.NewContext();
        await SubmitAsync(first, fixture.Ids);
        await using var retry = fixture.NewContext();
        await Assert.ThrowsAsync<InvalidOperationException>(() => SubmitAsync(retry, fixture.Ids));
        Assert.Single(await retry.AuditLogs.ToListAsync());
    }

    [Theory]
    [InlineData("no-permission")]
    [InlineData("inactive-membership")]
    [InlineData("inactive-status")]
    [InlineData("inactive-user")]
    [InlineData("no-membership")]
    [InlineData("cross-property")]
    [InlineData("platform-admin-without-membership")]
    public async Task RequiresActiveMembershipAndPropertyEdit(string denial)
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var membership = await db.UserPropertyAccesses.SingleAsync();
        switch (denial)
        {
            case "no-permission": membership.PermissionMatrixJson = JsonSerializer.Serialize(PropertyPermissionMatrixDefaults.CreateEmpty()); break;
            case "inactive-membership": membership.IsActive = false; break;
            case "inactive-status": membership.Status = PropertyUserStatus.Inactive; break;
            case "inactive-user": (await db.Users.SingleAsync(user => user.Id == ids.OwnerId)).IsActive = false; break;
            case "no-membership": db.UserPropertyAccesses.Remove(membership); break;
        }
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Service(db).SubmitForReviewAsync(
            denial == "platform-admin-without-membership" ? ids.AdminId : ids.OwnerId,
            denial == "platform-admin-without-membership" ? UserRole.SuperAdmin : UserRole.Client,
            denial == "cross-property" ? ids.PropertyId + 100 : ids.PropertyId));
        await AssertUnchangedAsync(fixture);
    }

    [Fact]
    public async Task AuditFailure_RollsBackStatusAndAudit()
    {
        var failure = new FailReviewAudit();
        await using var fixture = await Fixture.CreateAsync(interceptor: failure);
        failure.Enabled = true;
        await using var db = fixture.NewContext();
        await Assert.ThrowsAsync<DbUpdateException>(() => SubmitAsync(db, fixture.Ids));
        await AssertUnchangedAsync(fixture);
    }

    [Fact]
    public async Task AnotherExistingPropertyCannotBeSubmittedThroughOwnMembership()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var other = await PropertyApprovalTestData.SeedAsync(db, PropertyStatus.Draft);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Service(db)
            .SubmitForReviewAsync(fixture.Ids.OwnerId, UserRole.Client, other.PropertyId));
        Assert.All(await db.Properties.ToListAsync(), property => Assert.Equal(PropertyStatus.Draft, property.Status));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task NoRoomsOrOperationalConfiguration_DoesNotPreventSubmission()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        db.RoomTypes.RemoveRange(await db.RoomTypes.ToListAsync());
        await db.SaveChangesAsync();
        Assert.Equal(PropertyStatus.PendingReview, (await SubmitAsync(db, fixture.Ids)).Status);
    }

    [Fact]
    public async Task CompletionReadFailure_DoesNotSubmitOrAudit()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        await Assert.ThrowsAsync<TimeoutException>(() => PropertyApprovalTestData.Service(db, new UnavailableCompletion())
            .SubmitForReviewAsync(fixture.Ids.OwnerId, UserRole.Client, fixture.Ids.PropertyId));
        await AssertUnchangedAsync(fixture);
    }

    [Fact]
    public async Task SubmissionDoesNotChangeExistingReservationsSessionsOrPayments()
    {
        await using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
        var ids = await PropertyApprovalTestData.SeedAsync(db, PropertyStatus.Draft);
        var session = new BookingSession { ClientId = ids.OwnerId, PropertyId = ids.PropertyId, SessionCode = "REVIEW-TEST", Currency = "IRR" };
        db.BookingSessions.Add(session);
        db.Reservations.Add(new Reservation { BookingSession = session, PropertyId = ids.PropertyId, RoomTypeId = ids.RoomTypeId,
            ClientId = ids.OwnerId, Status = ReservationStatus.Confirmed, AdultCount = 1, TotalPrice = 123,
            CheckInDate = new(2035, 1, 1), CheckOutDate = new(2035, 1, 2) });
        db.Payments.Add(new Payment { BookingSession = session, Status = PaymentStatus.Pending, Amount = 123 });
        await db.SaveChangesAsync();
        var before = db.ChangeTracker.Entries().Where(entry => entry.Entity is Reservation or BookingSession or Payment)
            .Select(entry => (entry.Entity, Values: JsonSerializer.Serialize(entry.CurrentValues.ToObject()))).ToArray();
        await SubmitAsync(db, ids);
        foreach (var (entity, values) in before)
            Assert.Equal(values, JsonSerializer.Serialize(db.Entry(entity).CurrentValues.ToObject()));
    }

    private sealed class UnavailableCompletion : IPropertyCompletionService
    {
        public Task<PropertyCompletionResponse> CalculateAsync(int propertyId, CancellationToken cancellationToken = default) =>
            throw new TimeoutException("Injected completion read failure.");
        public Task<PropertyCompletionResponse> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
            throw new TimeoutException("Injected completion read failure.");
    }

    [Fact]
    public void EndpointRetainsOwnerAuthorizationAndUsesPost()
    {
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(OwnerPropertiesController), typeof(OwnerAuthorizeAttribute)));
        var method = typeof(OwnerPropertiesController).GetMethod(nameof(OwnerPropertiesController.SubmitForReview))!;
        Assert.Equal("{id:int}/submit-for-review", Assert.IsType<HttpPostAttribute>(
            Attribute.GetCustomAttribute(method, typeof(HttpPostAttribute))).Template);
    }

    private static Task<PropertyResponse> SubmitAsync(KoochDbContext db, PropertyApprovalTestData.Ids ids) =>
        PropertyApprovalTestData.Service(db).SubmitForReviewAsync(ids.OwnerId, UserRole.Client, ids.PropertyId);

    private static ExceptionContext ExceptionContext(Exception error) => new(
        new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), []) { Exception = error };

    private static async Task AssertUnchangedAsync(Fixture fixture, PropertyStatus status = PropertyStatus.Draft)
    {
        await using var verify = fixture.NewContext();
        Assert.Equal(status, (await verify.Properties.SingleAsync()).Status);
        Assert.Empty(await verify.AuditLogs.ToListAsync());
    }

    private sealed class FailReviewAudit : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData,
            int result, CancellationToken cancellationToken = default)
        {
            // Fail after SQL writes, before the enclosing approval transaction commits.
            if (Enabled)
                throw new DbUpdateException("Injected review audit failure.");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Fixture(SqliteConnection connection, DbContextOptions<KoochDbContext> options,
        PropertyApprovalTestData.Ids ids) : IAsyncDisposable
    {
        public PropertyApprovalTestData.Ids Ids { get; } = ids;
        public KoochDbContext NewContext() => new(options);
        public static async Task<Fixture> CreateAsync(PropertyStatus status = PropertyStatus.Draft, IInterceptor? interceptor = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var builder = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection);
            if (interceptor is not null) builder.AddInterceptors(interceptor);
            await using var db = new KoochDbContext(builder.Options);
            await db.Database.EnsureCreatedAsync();
            return new(connection, builder.Options, await PropertyApprovalTestData.SeedAsync(db, status));
        }
        public ValueTask DisposeAsync() => connection.DisposeAsync();
    }
}
