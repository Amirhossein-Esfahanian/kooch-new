using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicBookingModeComposerTests
{
    [Theory]
    [InlineData(AvailabilityStatus.Available, SameNightBookingPolicyResult.InstantEligible,
        AvailabilityStatus.Available, PublicBookingDecisionReason.None)]
    [InlineData(AvailabilityStatus.Available, SameNightBookingPolicyResult.RequiresApproval,
        AvailabilityStatus.OnRequest, PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(AvailabilityStatus.Available, SameNightBookingPolicyResult.Closed,
        AvailabilityStatus.Unavailable, PublicBookingDecisionReason.SameNightFinalCutoff)]
    [InlineData(AvailabilityStatus.OnRequest, SameNightBookingPolicyResult.InstantEligible,
        AvailabilityStatus.OnRequest, PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(AvailabilityStatus.OnRequest, SameNightBookingPolicyResult.RequiresApproval,
        AvailabilityStatus.OnRequest, PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(AvailabilityStatus.OnRequest, SameNightBookingPolicyResult.Closed,
        AvailabilityStatus.Unavailable, PublicBookingDecisionReason.SameNightFinalCutoff)]
    [InlineData(AvailabilityStatus.Unavailable, SameNightBookingPolicyResult.InstantEligible,
        AvailabilityStatus.Unavailable, PublicBookingDecisionReason.ExistingUnavailable)]
    [InlineData(AvailabilityStatus.Unavailable, SameNightBookingPolicyResult.RequiresApproval,
        AvailabilityStatus.Unavailable, PublicBookingDecisionReason.ExistingUnavailable)]
    [InlineData(AvailabilityStatus.Unavailable, SameNightBookingPolicyResult.Closed,
        AvailabilityStatus.Unavailable, PublicBookingDecisionReason.ExistingUnavailable)]
    public void EffectiveAvailabilityAndPolicy_ProduceMonotonicDecision(
        AvailabilityStatus effectiveStatus,
        SameNightBookingPolicyResult policy,
        AvailabilityStatus expectedStatus,
        PublicBookingDecisionReason expectedReason)
    {
        var result = PublicBookingModeComposer.Compose(Night(effectiveStatus), policy);

        Assert.Equal(expectedStatus, result.Status);
        Assert.Equal(expectedReason, result.Reason);
    }

    [Theory]
    [InlineData(SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(SameNightBookingPolicyResult.Closed)]
    public void CalendarClosed_NeverReopensAndKeepsItsReason(SameNightBookingPolicyResult policy)
    {
        var result = PublicBookingModeComposer.Compose(Night(AvailabilityStatus.Available, isClosed: true), policy);

        Assert.Equal(AvailabilityStatus.Unavailable, result.Status);
        Assert.Equal(PublicBookingDecisionReason.ExistingClosed, result.Reason);
    }

    [Theory]
    [InlineData(AvailabilityStatus.Available)]
    [InlineData(AvailabilityStatus.OnRequest)]
    public void ZeroEffectiveCapacity_RemainsUnavailable(AvailabilityStatus status)
    {
        var result = PublicBookingModeComposer.Compose(Night(status, remainingCapacity: 0),
            SameNightBookingPolicyResult.InstantEligible);

        Assert.Equal(AvailabilityStatus.Unavailable, result.Status);
        Assert.Equal(PublicBookingDecisionReason.ExistingUnavailable, result.Reason);
    }

    [Fact]
    public void PolicyDowngradeReasons_AreDistinctFromExistingCalendarReasons()
    {
        var calendarOnRequest = PublicBookingModeComposer.Compose(
            Night(AvailabilityStatus.OnRequest), SameNightBookingPolicyResult.RequiresApproval);
        var policyOnRequest = PublicBookingModeComposer.Compose(
            Night(AvailabilityStatus.Available), SameNightBookingPolicyResult.RequiresApproval);
        var existingUnavailable = PublicBookingModeComposer.Compose(
            Night(AvailabilityStatus.Unavailable), SameNightBookingPolicyResult.Closed);
        var cutoffUnavailable = PublicBookingModeComposer.Compose(
            Night(AvailabilityStatus.Available), SameNightBookingPolicyResult.Closed);

        Assert.NotEqual(calendarOnRequest.Reason, policyOnRequest.Reason);
        Assert.NotEqual(existingUnavailable.Reason, cutoffUnavailable.Reason);
    }

    [Fact]
    public void DecisionContract_ContainsOnlyMachineReadableEnums()
    {
        Assert.Equal(typeof(AvailabilityStatus), typeof(PublicBookingDecision).GetProperty(nameof(PublicBookingDecision.Status))!.PropertyType);
        Assert.Equal(typeof(PublicBookingDecisionReason), typeof(PublicBookingDecision).GetProperty(nameof(PublicBookingDecision.Reason))!.PropertyType);
    }

    private static EffectiveAvailabilityNight Night(
        AvailabilityStatus status, bool isClosed = false, int remainingCapacity = 1) => new()
    {
        ConfiguredStatus = status,
        EffectiveStatus = status,
        IsClosed = isClosed,
        RemainingCapacity = remainingCapacity
    };
}
