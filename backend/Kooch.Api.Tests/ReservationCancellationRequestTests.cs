using System.Reflection;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCancellationRequestTests
{
    [Fact]
    public async Task OwnReservation_CreatesPendingRequestWithCanonicalUserAndGuestSafeProjection()
    {
        await using var context = NewContext();
        Seed(context);
        var result = await Service(context).CreateAsync(1, " R-100001 ", Request());
        var saved = Assert.Single(context.ReservationCancellationRequests);
        Assert.Equal(1, saved.RequestedByUserId);
        Assert.Equal(1, saved.CreatedByUserId);
        Assert.Equal(10, saved.ReservationId);
        Assert.Equal(ReservationCancellationRequestStatus.Pending, result.Status);
        Assert.Equal(ReservationCancellationReason.GuestRequest, result.Reason);
        Assert.Equal("Please cancel", result.Message);
        Assert.Equal(saved.RequestedAtUtc, result.RequestedAtUtc);
        Assert.Null(result.ResolvedAtUtc);
    }

    [Fact]
    public async Task Create_DoesNotMutateReservationOrFinance()
    {
        await using var context = NewContext();
        Seed(context);
        await Service(context).CreateAsync(1, "R-100001", Request());
        var reservation = await context.Reservations.SingleAsync(row => row.Id == 10);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Null(reservation.CancellationIdempotencyKey);
        Assert.Null(reservation.CancellationRequestFingerprint);
        Assert.Empty(context.CancellationFinancialResolutions);
        Assert.Empty(context.RefundRecords);
        Assert.Empty(context.WalletEntries);
        Assert.Empty(context.FinancialEntries);
    }

    [Theory]
    [InlineData(2, "R-100001")]
    [InlineData(1, "R-999999")]
    public async Task ForeignOrMissingReservation_IsNotFound(int actor, string number)
    {
        await using var context = NewContext();
        Seed(context);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(context).CreateAsync(actor, number, Request()));
        Assert.Empty(context.ReservationCancellationRequests);
    }

    [Fact]
    public async Task CancelledReservation_IsRejected()
    {
        await using var context = NewContext();
        Seed(context);
        context.Reservations.Single(row => row.Id == 10).Status = ReservationStatus.Cancelled;
        await context.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(context).CreateAsync(1, "R-100001", Request()));
        Assert.Empty(context.ReservationCancellationRequests);
    }

    [Fact]
    public async Task SecondPendingRequest_IsConflict()
    {
        await using var context = NewContext();
        Seed(context);
        await Service(context).CreateAsync(1, "R-100001", Request());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(context).CreateAsync(1, "R-100001", Request()));
        Assert.Single(context.ReservationCancellationRequests);
    }

    [Theory]
    [InlineData(ReservationCancellationRequestStatus.Resolved)]
    [InlineData(ReservationCancellationRequestStatus.Rejected)]
    public async Task HistoricalRequest_RemainsAndNewPendingCanBeCreated(ReservationCancellationRequestStatus status)
    {
        await using var context = NewContext();
        Seed(context);
        context.ReservationCancellationRequests.Add(new ReservationCancellationRequestRecord
        {
            ReservationId = 10, RequestedByUserId = 1, Reason = ReservationCancellationReason.GuestRequest,
            Status = status, RequestedAtUtc = DateTime.UtcNow.AddDays(-1)
        });
        await context.SaveChangesAsync();
        await Service(context).CreateAsync(1, "R-100001", Request());
        Assert.Equal(2, context.ReservationCancellationRequests.Count());
        Assert.Contains(context.ReservationCancellationRequests, row => row.Status == status);
    }

    [Fact]
    public async Task GetLatest_ReturnsCurrentRequestWithoutStaffIdentifiers()
    {
        await using var context = NewContext();
        Seed(context);
        context.ReservationCancellationRequests.Add(new ReservationCancellationRequestRecord
        {
            ReservationId = 10, RequestedByUserId = 1, Status = ReservationCancellationRequestStatus.Rejected,
            Reason = ReservationCancellationReason.Other, RequestedAtUtc = DateTime.UtcNow.AddDays(-1),
            ResolvedByUserId = 2, ResolutionNote = "Please contact support"
        });
        await context.SaveChangesAsync();
        await Service(context).CreateAsync(1, "R-100001", Request());
        var latest = await Service(context).GetLatestAsync(1, "R-100001");
        Assert.Equal(ReservationCancellationRequestStatus.Pending, latest.Status);
        Assert.Equal("Please cancel", latest.Message);
        Assert.DoesNotContain(typeof(ReservationCancellationRequestResponse).GetProperties(), property =>
            property.Name.EndsWith("UserId", StringComparison.Ordinal) ||
            property.Name.EndsWith("FinanceId", StringComparison.Ordinal) ||
            property.Name == "ResolutionNote");
    }

    [Theory]
    [InlineData(2, "R-100001")]
    [InlineData(1, "R-999999")]
    public async Task GetLatest_HidesForeignOrMissingReservation(int actor, string number)
    {
        await using var context = NewContext();
        Seed(context);
        await Service(context).CreateAsync(1, "R-100001", Request());
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(context).GetLatestAsync(actor, number));
    }

    [Fact]
    public async Task GetLatest_NoRequestIsNotFound()
    {
        await using var context = NewContext();
        Seed(context);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(context).GetLatestAsync(1, "R-100001"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData((ReservationCancellationReason)999)]
    public async Task InvalidOrMissingReason_IsRejected(ReservationCancellationReason? reason)
    {
        await using var context = NewContext();
        Seed(context);
        await Assert.ThrowsAsync<ArgumentException>(() => Service(context).CreateAsync(1, "R-100001", new() { Reason = reason }));
    }

    [Fact]
    public void GuestRoute_IsAuthenticatedAndRequestCannotSupplyUserId()
    {
        Assert.NotNull(typeof(AccountReservationsController).GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(typeof(CreateReservationCancellationRequest).GetProperty("RequestedByUserId"));
        Assert.Equal(new[] { "Message", "Reason" }, typeof(CreateReservationCancellationRequest)
            .GetProperties().Select(property => property.Name).OrderBy(name => name));
    }

    [Fact]
    public async Task SubmittedHistory_CannotBeEditedOrDeleted()
    {
        await using var context = NewContext();
        Seed(context);
        await Service(context).CreateAsync(1, "R-100001", Request());
        var row = context.ReservationCancellationRequests.Single();
        row.GuestMessage = "Changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
        context.Entry(row).Reload();
        context.ReservationCancellationRequests.Remove(row);
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public void SqlServerModel_UsesNonCascadeForeignKeysAndPendingUniqueIndex()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata_only;Integrated Security=True;TrustServerCertificate=True").Options);
        var entity = context.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(ReservationCancellationRequestRecord))!;
        Assert.All(entity.GetForeignKeys(), key => Assert.Equal(DeleteBehavior.NoAction, key.DeleteBehavior));
        var index = Assert.Single(entity.GetIndexes(), index => index.IsUnique &&
            index.Properties.Single().Name == nameof(ReservationCancellationRequestRecord.ReservationId));
        Assert.Equal("[Status] = 0", index.GetFilter());
        Assert.Single(entity.GetCheckConstraints(), check => check.Name == "CK_ReservationCancellationRequests_Status");
    }

    [Fact]
    public void Migration_OnlyCreatesRequestTableAndIndexes()
    {
        var operations = new AddReservationCancellationRequests().UpOperations;
        Assert.Single(operations.OfType<CreateTableOperation>(), table => table.Name == "ReservationCancellationRequests");
        Assert.All(operations, operation => Assert.True(operation is CreateTableOperation or CreateIndexOperation));
        var table = Assert.Single(operations.OfType<CreateTableOperation>());
        Assert.Equal(3, table.ForeignKeys.Count);
        Assert.All(table.ForeignKeys, key => Assert.Equal(ReferentialAction.NoAction, key.OnDelete));
        Assert.Contains(operations.OfType<CreateIndexOperation>(), index => index.IsUnique && index.Filter == "[Status] = 0");
    }

    private static CreateReservationCancellationRequest Request() => new()
    {
        Reason = ReservationCancellationReason.GuestRequest, Message = " Please cancel "
    };

    private static ReservationCancellationRequestService Service(KoochDbContext context) => new(context, null!);

    private static KoochDbContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);

    private static void Seed(KoochDbContext context)
    {
        context.Users.AddRange(
            new User { Id = 1, FirstName = "Guest", LastName = "One", Email = "one@test.local", PasswordHash = "unused" },
            new User { Id = 2, FirstName = "Other", LastName = "Two", Email = "two@test.local", PasswordHash = "unused" });
        context.Guests.Add(new Guest { Id = 3, UserId = 1, FirstName = "Guest", LastName = "One" });
        context.Reservations.Add(new Reservation
        {
            Id = 10, ReservationNumber = "R-100001", ClientId = 1, GuestId = 3,
            PropertyId = 20, RoomTypeId = 30, Status = ReservationStatus.Confirmed,
            CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2)
        });
        context.SaveChanges();
    }
}
