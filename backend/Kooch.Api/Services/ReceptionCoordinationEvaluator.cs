namespace Kooch.Api.Services;

public enum ReceptionCoordinationResult
{
    NotConfigured,
    ArrivalUnspecified,
    InsideRegularReception,
    CoordinationRequired
}

public static class ReceptionCoordinationEvaluator
{
    public static ReceptionCoordinationResult Evaluate(
        TimeOnly? regularReceptionFrom,
        TimeOnly? regularReceptionUntil,
        TimeOnly? expectedArrivalTime)
    {
        PropertyBookingSettingsValidator.ValidateReceptionWindow(regularReceptionFrom, regularReceptionUntil);
        if (regularReceptionFrom is not { } from || regularReceptionUntil is not { } until)
            return ReceptionCoordinationResult.NotConfigured;
        if (expectedArrivalTime is not { } arrival)
            return ReceptionCoordinationResult.ArrivalUnspecified;

        var inside = from < until
            ? arrival >= from && arrival <= until
            : arrival >= from || arrival <= until;
        return inside
            ? ReceptionCoordinationResult.InsideRegularReception
            : ReceptionCoordinationResult.CoordinationRequired;
    }
}
