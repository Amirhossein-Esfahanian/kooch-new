namespace Kooch.Api.Services;

public readonly record struct SameNightBookingDeadline(TimeOnly Time, int DayOffset);

public enum SameNightBookingPolicyResult
{
    InstantEligible,
    RequiresApproval,
    Closed
}

public static class SameNightBookingPolicyEvaluator
{
    public static SameNightBookingPolicyResult Evaluate(
        DateOnly hotelNight,
        DateTimeOffset nowUtc,
        TimeZoneInfo businessTimeZone,
        SameNightBookingDeadline? instantDeadline,
        SameNightBookingDeadline? finalCutoff)
    {
        ArgumentNullException.ThrowIfNull(businessTimeZone);
        Validate(instantDeadline, finalCutoff);

        // An absent deadline leaves that part of the legacy booking mode unchanged.
        if (finalCutoff is { } final && nowUtc >= ResolveUtc(hotelNight, final, businessTimeZone))
            return SameNightBookingPolicyResult.Closed;

        if (instantDeadline is { } instant && nowUtc >= ResolveUtc(hotelNight, instant, businessTimeZone))
            return SameNightBookingPolicyResult.RequiresApproval;

        return SameNightBookingPolicyResult.InstantEligible;
    }

    public static void Validate(
        SameNightBookingDeadline? instantDeadline,
        SameNightBookingDeadline? finalCutoff)
    {
        ValidateOffset(instantDeadline);
        ValidateOffset(finalCutoff);

        if (instantDeadline is { } instant && finalCutoff is { } final &&
            LocalOffset(instant) > LocalOffset(final))
            throw new ArgumentException("The instant deadline must not be after the final cutoff.");
    }

    private static void ValidateOffset(SameNightBookingDeadline? deadline)
    {
        if (deadline is { DayOffset: < 0 or > 1 })
            throw new ArgumentOutOfRangeException(nameof(deadline), "DayOffset must be 0 or 1.");
    }

    private static TimeSpan LocalOffset(SameNightBookingDeadline deadline) =>
        TimeSpan.FromDays(deadline.DayOffset) + deadline.Time.ToTimeSpan();

    private static DateTimeOffset ResolveUtc(
        DateOnly hotelNight,
        SameNightBookingDeadline deadline,
        TimeZoneInfo businessTimeZone)
    {
        var localDate = hotelNight.AddDays(deadline.DayOffset);
        var local = localDate.ToDateTime(deadline.Time, DateTimeKind.Unspecified);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, businessTimeZone), TimeSpan.Zero);
    }
}
