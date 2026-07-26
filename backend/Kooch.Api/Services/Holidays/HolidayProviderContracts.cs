using System.Collections.ObjectModel;
using System.Net;

namespace Kooch.Api.Services.Holidays;

public sealed record HolidayProviderYear
{
    public HolidayProviderYear(
        string providerName,
        int requestedSolarYear,
        int sourceSolarYear,
        IEnumerable<HolidayProviderDay> holidays)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(providerName);
        ArgumentNullException.ThrowIfNull(holidays);

        ProviderName = providerName;
        RequestedSolarYear = requestedSolarYear;
        SourceSolarYear = sourceSolarYear;
        Holidays = new ReadOnlyCollection<HolidayProviderDay>(holidays.ToArray());
    }

    public string ProviderName { get; }
    public int RequestedSolarYear { get; }
    public int SourceSolarYear { get; }
    public IReadOnlyList<HolidayProviderDay> Holidays { get; }
}

public sealed record HolidayProviderDay
{
    public HolidayProviderDay(
        DateOnly date,
        int solarYear,
        int solarMonth,
        int solarDay,
        DayOfWeek dayOfWeek,
        bool isWeeklyHoliday,
        bool isOfficialHoliday,
        IEnumerable<string> occasionTitles)
    {
        ArgumentNullException.ThrowIfNull(occasionTitles);

        Date = date;
        SolarYear = solarYear;
        SolarMonth = solarMonth;
        SolarDay = solarDay;
        DayOfWeek = dayOfWeek;
        IsWeeklyHoliday = isWeeklyHoliday;
        IsOfficialHoliday = isOfficialHoliday;
        OccasionTitles = new ReadOnlyCollection<string>(occasionTitles.ToArray());
    }

    public DateOnly Date { get; }
    public int SolarYear { get; }
    public int SolarMonth { get; }
    public int SolarDay { get; }
    public DayOfWeek DayOfWeek { get; }
    public bool IsWeeklyHoliday { get; }
    public bool IsOfficialHoliday { get; }
    public IReadOnlyList<string> OccasionTitles { get; }
}

public enum HolidayProviderFailureKind
{
    Disabled,
    NetworkOrTimeout,
    Http,
    SchemaOrDeserialization,
    Validation
}

public sealed class HolidayProviderException : Exception
{
    public HolidayProviderException(
        HolidayProviderFailureKind failureKind,
        string message,
        Exception? innerException = null,
        HttpStatusCode? statusCode = null)
        : base(message, innerException)
    {
        FailureKind = failureKind;
        StatusCode = statusCode;
    }

    public HolidayProviderFailureKind FailureKind { get; }
    public HttpStatusCode? StatusCode { get; }
}
