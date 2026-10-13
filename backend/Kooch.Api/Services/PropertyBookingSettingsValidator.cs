namespace Kooch.Api.Services;

internal static class PropertyBookingSettingsValidator
{
    internal static void Validate(
        TimeOnly? regularReceptionFrom,
        TimeOnly? regularReceptionUntil,
        TimeOnly? instantTime,
        short? instantDayOffset,
        TimeOnly? finalTime,
        short? finalDayOffset)
    {
        ValidateReceptionWindow(regularReceptionFrom, regularReceptionUntil);

        var instant = ToDeadline(instantTime, instantDayOffset, "Instant booking deadline");
        var final = ToDeadline(finalTime, finalDayOffset, "Final booking cutoff");
        SameNightBookingPolicyEvaluator.Validate(instant, final);
    }

    internal static void ValidateReceptionWindow(TimeOnly? from, TimeOnly? until)
    {
        if (from.HasValue != until.HasValue)
            throw new ArgumentException("Regular reception hours must be configured together.");
        if (from.HasValue && from == until)
            throw new ArgumentException("Regular reception hours cannot have equal endpoints.");
    }

    internal static SameNightBookingDeadline? ToDeadline(
        TimeOnly? time,
        short? dayOffset,
        string settingName)
    {
        if (time.HasValue != dayOffset.HasValue)
            throw new ArgumentException($"{settingName} requires both time and day offset.");

        return time.HasValue
            ? new SameNightBookingDeadline(time.Value, dayOffset!.Value)
            : null;
    }
}
