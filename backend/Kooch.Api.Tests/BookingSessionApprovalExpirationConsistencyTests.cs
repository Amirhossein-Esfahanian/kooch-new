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
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100),
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 200));

        Assert.True(summary.IsPaymentReady);
        Assert.False(summary.CanContinueWithApprovedReservations);
        Assert.Equal(2, summary.PayableReservationCount);
        Assert.Equal(300, summary.PayableAmount);
        Assert.Equal(300, summary.OriginalTotalAmount);
        Assert.Null(summary.ContinuationPaymentDeadlineUtc);
        Assert.False(summary.HasPendingApprovals);
        Assert.False(summary.HasRejectedReservations);
        Assert.False(summary.HasInconsistentPaymentDeadlines);
        Assert.Equal(SharedDeadline, summary.EarliestPaymentDeadlineUtc);
    }

    [Fact]
    public void SingleApprovedReservation_PreservesNormalPaymentSemantics()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100));

        Assert.True(summary.IsPaymentReady);
        Assert.False(summary.CanContinueWithApprovedReservations);
        Assert.Equal(1, summary.PayableReservationCount);
        Assert.Equal(100, summary.PayableAmount);
    }

    [Fact]
    public void RejectedOnlySession_HasNoPayableContinuation()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.Rejected, finalAmount: 100));

        Assert.False(summary.IsPaymentReady);
        Assert.False(summary.CanContinueWithApprovedReservations);
        Assert.Equal(0, summary.PayableReservationCount);
        Assert.Equal(0, summary.PayableAmount);
        Assert.Equal(100, summary.OriginalTotalAmount);
    }

    [Fact]
    public void MixedCurrencyPayableChildren_AreNotContinuationEligible()
    {
        var summary = BookingSessionQueryService.BuildSummary(
        [
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100),
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 200, "USD"),
            Reservation(ReservationStatus.Rejected, finalAmount: 300)
        ], "IRR");

        Assert.False(summary.CanContinueWithApprovedReservations);
        Assert.Equal(2, summary.PayableReservationCount);
        Assert.Equal(300, summary.PayableAmount);
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

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.HasInconsistentPaymentDeadlines);
        Assert.Equal(SharedDeadline, summary.EarliestPaymentDeadlineUtc);
        Assert.Equal(SharedDeadline, reservations[0].PaymentExpiresAtUtc);
        Assert.Equal(laterDeadline, reservations[1].PaymentExpiresAtUtc);
    }

    [Fact]
    public void RejectedChild_PreventsPaymentReadiness()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100),
            Reservation(ReservationStatus.Rejected, finalAmount: 200));

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.HasRejectedReservations);
        Assert.True(summary.CanContinueWithApprovedReservations);
        Assert.Equal(1, summary.PayableReservationCount);
        Assert.Equal(100, summary.PayableAmount);
        Assert.Equal(300, summary.OriginalTotalAmount);
        Assert.Equal(SharedDeadline, summary.ContinuationPaymentDeadlineUtc);
    }

    [Fact]
    public void MixedClosedSummary_UsesAllApprovedChildrenAndEarliestDeadline()
    {
        var earlierDeadline = SharedDeadline.AddMinutes(-10);
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100),
            Reservation(ReservationStatus.Rejected, finalAmount: 200),
            Reservation(ReservationStatus.ApprovedAwaitingPayment, earlierDeadline, 300));

        Assert.False(summary.IsPaymentReady);
        Assert.True(summary.CanContinueWithApprovedReservations);
        Assert.Equal(2, summary.PayableReservationCount);
        Assert.Equal(400, summary.PayableAmount);
        Assert.Equal(600, summary.OriginalTotalAmount);
        Assert.Equal(earlierDeadline, summary.ContinuationPaymentDeadlineUtc);
    }

    [Fact]
    public void MixedOpenSummary_DoesNotExposeContinuation()
    {
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, SharedDeadline, 100),
            Reservation(ReservationStatus.PendingApproval, finalAmount: 200));

        Assert.False(summary.IsPaymentReady);
        Assert.False(summary.CanContinueWithApprovedReservations);
        Assert.True(summary.HasPendingApprovals);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void InvalidApprovedDeadline_PreventsContinuation(bool expired)
    {
        var deadline = expired ? DateTime.UtcNow.AddMinutes(-1) : (DateTime?)null;
        var summary = BuildSummary(
            Reservation(ReservationStatus.ApprovedAwaitingPayment, deadline, 100),
            Reservation(ReservationStatus.Rejected, finalAmount: 200));

        Assert.False(summary.CanContinueWithApprovedReservations);
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
        DateTime? paymentExpiresAtUtc = null,
        decimal finalAmount = 0,
        string currency = "IRR") =>
        new()
        {
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            Status = status,
            PaymentExpiresAtUtc = paymentExpiresAtUtc,
            FinalAmount = finalAmount,
            Currency = currency
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
