using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionApprovalExpirationConsistencyTests
{
    private static readonly DateTime SharedDeadline =
        new(2036, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AllPendingApprovals_AreNotPaymentReady()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.PendingApproval),
            Reservation(ReservationStatus.PendingApproval));

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.HasPendingApprovals);
        Assert.False(summary.HasRejectedReservations);
        Assert.Null(summary.EarliestPaymentDeadlineUtc);
    }

    [Fact]
    public void MixedApprovedAndPending_IsNotPaymentReady()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline),
            Reservation(ReservationStatus.PendingApproval));

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.HasPendingApprovals);
        Assert.Equal(SharedDeadline, summary.EarliestPaymentDeadlineUtc);
    }

    [Fact]
    public void AllApprovedWithSharedDeadline_ArePaymentReady()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline),
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline));

        Assert.True(summary.IsPaymentReady);
        Assert.False(summary.HasPendingApprovals);
        Assert.False(summary.HasRejectedReservations);
        Assert.False(summary.HasInconsistentPaymentDeadlines);
        Assert.Equal(SharedDeadline, summary.EarliestPaymentDeadlineUtc);
    }

    [Fact]
    public void DifferentPaymentDeadlines_AreReportedWithoutOverwritingEitherDeadline()
    {
        var laterDeadline = SharedDeadline.AddMinutes(15);
        var reservations = new[]
        {
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline),
            Reservation(ReservationStatus.ApprovedAwaitingPayment, laterDeadline)
        };

        var summary = BookingSessionQueryService.BuildSummary(reservations);

        Assert.True(summary.IsPaymentReady);
        Assert.True(summary.HasInconsistentPaymentDeadlines);
        Assert.Equal(SharedDeadline, summary.EarliestPaymentDeadlineUtc);
        Assert.Equal(SharedDeadline, reservations[0].PaymentExpiresAtUtc);
        Assert.Equal(laterDeadline, reservations[1].PaymentExpiresAtUtc);
    }

    [Fact]
    public void RejectedChild_PreventsPaymentReadiness()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline),
            Reservation(ReservationStatus.Rejected));

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.HasRejectedReservations);
    }

    [Fact]
    public async Task SessionChildExpiration_IsIdempotentAndReleasesItsCapacity()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var session = await AddSessionAsync(harness);
        var reservation = await harness.AddReservationAsync(
            ReservationStatus.ApprovedAwaitingPayment,
            paymentExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        reservation.BookingSessionId = session.Id;
        await harness.DbContext.SaveChangesAsync();

        Assert.Equal(0, await harness.GetRemainingCapacityAsync());
        Assert.True(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(1, await harness.GetRemainingCapacityAsync());
        Assert.Equal(
            ReservationStatus.PaymentExpired,
            (await harness.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
    }

    [Theory]
    [InlineData(ReservationStatus.Confirmed)]
    [InlineData(ReservationStatus.Paid)]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Rejected)]
    public async Task Expiration_DoesNotChangeProtectedSessionChildren(ReservationStatus status)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var session = await AddSessionAsync(harness);
        var reservation = await harness.AddReservationAsync(
            status,
            paymentExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        reservation.BookingSessionId = session.Id;
        await harness.DbContext.SaveChangesAsync();

        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(status, (await harness.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
    }

    private static BookingSessionDerivedSummaryResponse BuildSummary(
        params BookingSessionReservationDetailsResponse[] reservations) =>
        BookingSessionQueryService.BuildSummary(reservations);

    private static BookingSessionReservationDetailsResponse Reservation(
        ReservationStatus status,
        DateTime? paymentExpiresAtUtc = null) =>
        new()
        {
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            Status = status,
            PaymentExpiresAtUtc = paymentExpiresAtUtc
        };

    private static async Task<BookingSession> AddSessionAsync(ReservationTestHarness harness)
    {
        var session = new BookingSession
        {
            SessionCode = nameof(BookingSession),
            ClientId = 1,
            GuestId = 40,
            PropertyId = 10,
            Currency = nameof(BookingSession.Currency),
            RequestHash = new string(char.MaxValue, 64)
        };
        harness.DbContext.BookingSessions.Add(session);
        await harness.DbContext.SaveChangesAsync();
        return session;
    }
}
