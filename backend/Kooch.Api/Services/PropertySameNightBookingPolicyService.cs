using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public sealed class PropertySameNightBookingPolicyService(TimeProvider timeProvider)
    : IPropertySameNightBookingPolicyService
{
    public SameNightBookingPolicyResult Evaluate(Property property, DateOnly requestedCheckIn)
    {
        ArgumentNullException.ThrowIfNull(property);

        var instant = PropertyBookingSettingsValidator.ToDeadline(
            property.SameNightInstantBookingTime,
            property.SameNightInstantBookingDayOffset,
            "Instant booking deadline");
        var final = PropertyBookingSettingsValidator.ToDeadline(
            property.SameNightFinalBookingTime,
            property.SameNightFinalBookingDayOffset,
            "Final booking cutoff");

        var nowUtc = timeProvider.GetUtcNow();
        return SameNightBookingPolicyEvaluator.Evaluate(
            requestedCheckIn, nowUtc, IranSiteTime.BusinessTimeZone, instant, final);
    }
}
