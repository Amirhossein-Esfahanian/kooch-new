using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionPayableScopeResolverTests
{
    private static readonly DateTime UtcNow =
        new(2036, 1, 1, 12, 0, 0, DateTimeKind.Utc);
    private readonly BookingSessionPayableScopeResolver resolver = new();

    [Fact]
    public void MixedClosedScope_IncludesEveryApprovedChildAndKeepsRejectedChildren()
    {
        var firstDeadline = UtcNow.AddMinutes(20);
        var secondDeadline = UtcNow.AddMinutes(10);
        var children = new[]
        {
            Child(1, ReservationStatus.ApprovedAwaitingPayment, 100, firstDeadline),
            Child(2, ReservationStatus.Rejected, 200),
            Child(3, ReservationStatus.ApprovedAwaitingPayment, 300, secondDeadline)
        };

        var result = resolver.Resolve("IRR", children, UtcNow);

        Assert.True(result.IsApprovalPhaseClosed);
        Assert.True(result.CanContinueWithApprovedReservations);
        Assert.Equal(new[] { 1, 3 }, result.PayableChildren.Select(child => child.ReservationId));
        Assert.Equal(2, result.PayableChildren.Count);
        Assert.Equal("IRR", result.Currency);
        Assert.Equal(400, result.PayableAmount);
        Assert.Equal(secondDeadline, result.EarliestPayableDeadlineUtc);
        Assert.Equal(2, Assert.Single(result.RejectedChildren).ReservationId);
        Assert.Equal(3, result.AllChildren.Count);
        Assert.Empty(result.PendingApprovalChildren);
        Assert.Empty(result.UnsupportedChildren);
    }

    [Fact]
    public void PendingApproval_KeepsMixedScopeOpen()
    {
        var result = resolver.Resolve("IRR",
        [
            Child(1, ReservationStatus.ApprovedAwaitingPayment, 100, UtcNow.AddMinutes(10)),
            Child(2, ReservationStatus.PendingApproval, 200)
        ], UtcNow);

        Assert.False(result.IsApprovalPhaseClosed);
        Assert.False(result.CanContinueWithApprovedReservations);
        Assert.Single(result.PendingApprovalChildren);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void MissingOrExpiredPayableDeadline_IsNotEligible(bool useExpiredDeadline)
    {
        var deadline = useExpiredDeadline ? UtcNow.AddSeconds(-1) : (DateTime?)null;

        var result = resolver.Resolve("IRR",
        [
            Child(1, ReservationStatus.ApprovedAwaitingPayment, 100, deadline),
            Child(2, ReservationStatus.Rejected, 200)
        ], UtcNow);

        Assert.False(result.CanContinueWithApprovedReservations);
    }

    [Fact]
    public void CurrencyMismatch_IsDeterministicallyIneligible()
    {
        var result = resolver.Resolve("IRR",
        [
            Child(1, ReservationStatus.ApprovedAwaitingPayment, 100, UtcNow.AddMinutes(10)),
            Child(2, ReservationStatus.ApprovedAwaitingPayment, 200, UtcNow.AddMinutes(20), "USD"),
            Child(3, ReservationStatus.Rejected, 300)
        ], UtcNow);

        Assert.False(result.CanContinueWithApprovedReservations);
        Assert.Null(result.Currency);
        Assert.Equal(300, result.PayableAmount);
    }

    [Theory]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(ReservationStatus.Rejected)]
    public void UniformSession_DoesNotDuplicateTheNormalPaymentFlow(ReservationStatus status)
    {
        var deadline = status == ReservationStatus.ApprovedAwaitingPayment
            ? UtcNow.AddMinutes(10)
            : (DateTime?)null;

        var result = resolver.Resolve("IRR", [Child(1, status, 100, deadline)], UtcNow);

        Assert.False(result.CanContinueWithApprovedReservations);
    }

    [Fact]
    public void UnsupportedChildState_PreventsContinuationWithoutMutation()
    {
        var approved = Child(
            1,
            ReservationStatus.ApprovedAwaitingPayment,
            100,
            UtcNow.AddMinutes(10));
        var children = new[]
        {
            approved,
            Child(2, ReservationStatus.Rejected, 200),
            Child(3, ReservationStatus.PaymentExpired, 300)
        };

        var result = resolver.Resolve("IRR", children, UtcNow);

        Assert.False(result.CanContinueWithApprovedReservations);
        Assert.Single(result.UnsupportedChildren);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, approved.Status);
        Assert.Equal(UtcNow.AddMinutes(10), approved.PaymentExpiresAtUtc);
    }

    private static BookingSessionPayableChild Child(
        int reservationId,
        ReservationStatus status,
        decimal amount,
        DateTime? deadline = null,
        string currency = "IRR") =>
        new(reservationId, status, amount, currency, deadline);
}
