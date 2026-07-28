using System.Collections.ObjectModel;

namespace Kooch.Api.Dtos.Calendar;

public sealed record HolidayCalendarDaysResponse
{
    public HolidayCalendarDaysResponse(
        DateOnly from,
        DateOnly to,
        bool isRangeFullyCovered,
        int? coveredSolarYearFrom,
        int? coveredSolarYearTo,
        DateTime? lastSuccessfulSyncAtUtc,
        IEnumerable<HolidayCalendarDayResponse> days)
    {
        ArgumentNullException.ThrowIfNull(days);

        From = from;
        To = to;
        IsRangeFullyCovered = isRangeFullyCovered;
        CoveredSolarYearFrom = coveredSolarYearFrom;
        CoveredSolarYearTo = coveredSolarYearTo;
        LastSuccessfulSyncAtUtc = lastSuccessfulSyncAtUtc;
        Days = new ReadOnlyCollection<HolidayCalendarDayResponse>(days.ToArray());
    }

    public DateOnly From { get; }
    public DateOnly To { get; }
    public bool IsRangeFullyCovered { get; }
    public int? CoveredSolarYearFrom { get; }
    public int? CoveredSolarYearTo { get; }
    public DateTime? LastSuccessfulSyncAtUtc { get; }
    public IReadOnlyList<HolidayCalendarDayResponse> Days { get; }
}

public sealed record HolidayCalendarDayResponse
{
    public HolidayCalendarDayResponse(
        DateOnly date,
        int solarYear,
        int solarMonth,
        int solarDay,
        bool isWeeklyHoliday,
        bool isOfficialHoliday,
        IEnumerable<string> occasionTitles)
    {
        ArgumentNullException.ThrowIfNull(occasionTitles);

        Date = date;
        SolarYear = solarYear;
        SolarMonth = solarMonth;
        SolarDay = solarDay;
        IsWeeklyHoliday = isWeeklyHoliday;
        IsOfficialHoliday = isOfficialHoliday;
        OccasionTitles = new ReadOnlyCollection<string>(occasionTitles.ToArray());
    }

    public DateOnly Date { get; }
    public int SolarYear { get; }
    public int SolarMonth { get; }
    public int SolarDay { get; }
    public bool IsHoliday => true;
    public bool IsWeeklyHoliday { get; }
    public bool IsOfficialHoliday { get; }
    public IReadOnlyList<string> OccasionTitles { get; }
}
