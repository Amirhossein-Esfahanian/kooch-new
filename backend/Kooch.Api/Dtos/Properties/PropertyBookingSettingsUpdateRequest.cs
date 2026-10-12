namespace Kooch.Api.Dtos.Properties;

public abstract class PropertyBookingSettingsUpdateRequest : PropertyCoordinatesRequest
{
    private TimeOnly? regularReceptionFrom;
    private TimeOnly? regularReceptionUntil;
    private TimeOnly? sameNightInstantBookingTime;
    private short? sameNightInstantBookingDayOffset;
    private TimeOnly? sameNightFinalBookingTime;
    private short? sameNightFinalBookingDayOffset;

    internal bool HasRegularReceptionFrom { get; private set; }
    internal bool HasRegularReceptionUntil { get; private set; }
    internal bool HasSameNightInstantBookingTime { get; private set; }
    internal bool HasSameNightInstantBookingDayOffset { get; private set; }
    internal bool HasSameNightFinalBookingTime { get; private set; }
    internal bool HasSameNightFinalBookingDayOffset { get; private set; }

    public TimeOnly? RegularReceptionFrom
    {
        get => regularReceptionFrom;
        set { regularReceptionFrom = value; HasRegularReceptionFrom = true; }
    }

    public TimeOnly? RegularReceptionUntil
    {
        get => regularReceptionUntil;
        set { regularReceptionUntil = value; HasRegularReceptionUntil = true; }
    }

    public TimeOnly? SameNightInstantBookingTime
    {
        get => sameNightInstantBookingTime;
        set { sameNightInstantBookingTime = value; HasSameNightInstantBookingTime = true; }
    }

    public short? SameNightInstantBookingDayOffset
    {
        get => sameNightInstantBookingDayOffset;
        set { sameNightInstantBookingDayOffset = value; HasSameNightInstantBookingDayOffset = true; }
    }

    public TimeOnly? SameNightFinalBookingTime
    {
        get => sameNightFinalBookingTime;
        set { sameNightFinalBookingTime = value; HasSameNightFinalBookingTime = true; }
    }

    public short? SameNightFinalBookingDayOffset
    {
        get => sameNightFinalBookingDayOffset;
        set { sameNightFinalBookingDayOffset = value; HasSameNightFinalBookingDayOffset = true; }
    }
}
