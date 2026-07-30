using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationStatusWorkflowTests
{
    private readonly ReservationStatusWorkflow workflow = new();

    [Fact]
    public void PendingApproval_CanBeApprovedOrRejected()
    {
        Assert.True(workflow.CanTransition(
            ReservationStatus.PendingApproval,
            ReservationStatus.ApprovedAwaitingPayment));
        Assert.True(workflow.CanTransition(
            ReservationStatus.PendingApproval,
            ReservationStatus.Rejected));
    }

    [Fact]
    public void InvalidTransition_IsRejected()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            workflow.ValidateTransition(
                ReservationStatus.PendingApproval,
                ReservationStatus.Completed));

        Assert.Contains("Invalid reservation status transition", error.Message);
    }

    [Theory]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Rejected)]
    [InlineData(ReservationStatus.PaymentExpired)]
    [InlineData(ReservationStatus.CapacityLost)]
    [InlineData(ReservationStatus.Completed)]
    public void TerminalStatus_CannotTransitionAgain(ReservationStatus status)
    {
        Assert.Empty(workflow.GetAllowedTransitions(status));
        Assert.Throws<InvalidOperationException>(() =>
            workflow.ValidateTransition(status, ReservationStatus.Pending));
    }
}
