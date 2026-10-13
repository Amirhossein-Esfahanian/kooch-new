using System.Text.Json;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Theory]
    [InlineData("14:00", "23:00", "01:00", 1, true)]
    [InlineData("14:00", "23:00", "01:00", 0, true)]
    [InlineData("14:00", "23:00", "18:00", 0, false)]
    [InlineData("14:00", "23:00", "14:00", 0, false)]
    [InlineData("14:00", "23:00", "23:00", 0, false)]
    [InlineData(null, null, "01:00", 1, false)]
    [InlineData("14:00", "23:00", null, null, false)]
    [InlineData("22:00", "06:00", "01:00", 1, false)]
    [InlineData("22:00", "06:00", "21:00", 0, true)]
    public async Task ReceptionCoordination_AccountSnapshotsDecisionWithoutChangingReservationBehavior(
        string? from, string? until, string? arrival, int? offset, bool required)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await SetReceptionAsync(harness, from, until);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        request.ExpectedArrivalTime = ParseReceptionTime(arrival);
        request.ExpectedArrivalDayOffset = offset is null ? null : (byte)offset;
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var saved = await verification.BookingSessions.SingleAsync();
        Assert.Equal(required, saved.ReceptionCoordinationRequired);
        Assert.Null(saved.ReceptionCoordinationAcknowledgedAtUtc);
        Assert.Equal(request.ExpectedArrivalTime, saved.ExpectedArrivalTime);
        Assert.Equal(request.ExpectedArrivalDayOffset, saved.ExpectedArrivalDayOffset);
        var reservation = Assert.Single(result.Reservations);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status);
        Assert.Equal(100m, reservation.FinalAmount);
        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10], request.Items[0].CheckInDate, request.Items[0].CheckOutDate);
        Assert.All(availability[10].Nights.Values, night => Assert.Equal(1, night.RemainingCapacity));

        var query = new BookingSessionQueryService(verification);
        var account = await query.GetBySessionCodeForClientAsync(1, result.SessionCode);
        var admin = await query.GetByIdAsync(result.BookingSessionId);
        Assert.Equal(required, account.ReceptionCoordinationRequired);
        Assert.Equal(required, admin.ReceptionCoordinationRequired);
        Assert.Null(account.ReceptionCoordinationAcknowledgedAtUtc);
        Assert.Null(admin.ReceptionCoordinationAcknowledgedAtUtc);
        Assert.True(account.Summary.IsPaymentReady);
        var json = JsonSerializer.SerializeToElement(account, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(required, json.GetProperty("receptionCoordinationRequired").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("receptionCoordinationAcknowledgedAtUtc").ValueKind);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ReceptionCoordination_PropertyEditAndReplayPreserveSnapshotAndServerPolicyIsNotHashed(bool initiallyRequired)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await SetReceptionAsync(harness, initiallyRequired ? "14:00" : "22:00", initiallyRequired ? "23:00" : "06:00");
        var request = CreateAccountRequest(CreateAccountItem(10, null));
        request.ExpectedArrivalTime = new TimeOnly(1, 0);
        request.ExpectedArrivalDayOffset = 1;
        int firstId;
        await using (var scope = harness.CreateService())
            firstId = (await scope.Service.CreateForAccountAsync(1, request)).BookingSessionId;

        await SetReceptionAsync(harness, initiallyRequired ? "22:00" : "14:00", initiallyRequired ? "06:00" : "23:00");
        await using (var scope = harness.CreateService())
            Assert.Equal(firstId, (await scope.Service.CreateForAccountAsync(1, request)).BookingSessionId);

        // A new attempt snapshots the new policy, but keeps the same guest request hash.
        request.IdempotencyKey = Guid.NewGuid().ToString("N");
        await using (var scope = harness.CreateService())
            await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var sessions = await verification.BookingSessions.OrderBy(session => session.Id).ToListAsync();
        Assert.Equal(2, sessions.Count);
        Assert.Equal(initiallyRequired, sessions[0].ReceptionCoordinationRequired);
        Assert.Equal(!initiallyRequired, sessions[1].ReceptionCoordinationRequired);
        Assert.Equal(sessions[0].RequestHash, sessions[1].RequestHash);
        Assert.All(sessions, session => Assert.Null(session.ReceptionCoordinationAcknowledgedAtUtc));
        var read = await new BookingSessionQueryService(verification).GetByIdAsync(firstId);
        Assert.Equal(initiallyRequired, read.ReceptionCoordinationRequired);
    }

    [Theory]
    [InlineData("14:00", null)]
    [InlineData("14:00", "14:00")]
    public async Task ReceptionCoordination_InvalidStoredHoursFailAccountCreationBeforePersistence(string from, string? until)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await SetReceptionAsync(harness, from, until);
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            scope.Service.CreateForAccountAsync(1, CreateAccountRequest(CreateAccountItem(10, 100))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("14:00", "23:00")]
    [InlineData("14:00", null)]
    [InlineData("14:00", "14:00")]
    public async Task ReceptionCoordination_InternalCreationDoesNotEvaluateOrRequireReception(string? from, string? until)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await SetReceptionAsync(harness, from, until);
        await using var scope = harness.CreateService();

        await scope.Service.CreateAsync(CreateRequest(CreateItem(10, 100)));

        await using var verification = harness.CreateContext();
        var session = await verification.BookingSessions.SingleAsync();
        Assert.False(session.ReceptionCoordinationRequired);
        Assert.Null(session.ReceptionCoordinationAcknowledgedAtUtc);
    }

    [Fact]
    public void ReceptionCoordination_CreationRequestsDoNotExposeServerPolicyOrAcknowledgement()
    {
        foreach (var type in new[] { typeof(AccountBookingSessionCreateRequest), typeof(BookingSessionCreateRequest) })
        {
            Assert.Null(type.GetProperty(nameof(BookingSession.ReceptionCoordinationRequired)));
            Assert.Null(type.GetProperty(nameof(BookingSession.ReceptionCoordinationAcknowledgedAtUtc)));
        }
    }

    private static TimeOnly? ParseReceptionTime(string? value) => value is null ? null : TimeOnly.Parse(value);

    private static async Task SetReceptionAsync(BookingSessionTestHarness harness, string? from, string? until)
    {
        await using var setup = harness.CreateContext();
        var property = await setup.Properties.SingleAsync(property => property.Id == 1);
        property.RegularReceptionFrom = ParseReceptionTime(from);
        property.RegularReceptionUntil = ParseReceptionTime(until);
        await setup.SaveChangesAsync();
    }
}
