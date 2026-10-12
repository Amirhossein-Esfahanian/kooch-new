using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public enum PublicBookingDecisionReason
{
    None,
    ExistingUnavailable,
    ExistingClosed,
    ExistingOnRequest,
    SameNightApprovalRequired,
    SameNightFinalCutoff
}

public readonly record struct PublicBookingDecision(
    AvailabilityStatus Status,
    PublicBookingDecisionReason Reason);

public static class PublicBookingModeComposer
{
    public static PublicBookingDecision Compose(
        EffectiveAvailabilityNight availability,
        SameNightBookingPolicyResult policy)
    {
        ArgumentNullException.ThrowIfNull(availability);

        if (availability.IsClosed)
            return new(AvailabilityStatus.Unavailable, PublicBookingDecisionReason.ExistingClosed);

        if (availability.EffectiveStatus == AvailabilityStatus.Unavailable ||
            availability.RemainingCapacity <= 0)
            return new(AvailabilityStatus.Unavailable, PublicBookingDecisionReason.ExistingUnavailable);

        return (availability.EffectiveStatus, policy) switch
        {
            (AvailabilityStatus.Available, SameNightBookingPolicyResult.InstantEligible) =>
                new(AvailabilityStatus.Available, PublicBookingDecisionReason.None),
            (AvailabilityStatus.Available, SameNightBookingPolicyResult.RequiresApproval) =>
                new(AvailabilityStatus.OnRequest, PublicBookingDecisionReason.SameNightApprovalRequired),
            (AvailabilityStatus.Available, SameNightBookingPolicyResult.Closed) =>
                new(AvailabilityStatus.Unavailable, PublicBookingDecisionReason.SameNightFinalCutoff),
            (AvailabilityStatus.OnRequest, SameNightBookingPolicyResult.InstantEligible or SameNightBookingPolicyResult.RequiresApproval) =>
                new(AvailabilityStatus.OnRequest, PublicBookingDecisionReason.ExistingOnRequest),
            (AvailabilityStatus.OnRequest, SameNightBookingPolicyResult.Closed) =>
                new(AvailabilityStatus.Unavailable, PublicBookingDecisionReason.SameNightFinalCutoff),
            _ => throw new ArgumentOutOfRangeException(nameof(policy), "Unsupported availability or policy status.")
        };
    }
}
