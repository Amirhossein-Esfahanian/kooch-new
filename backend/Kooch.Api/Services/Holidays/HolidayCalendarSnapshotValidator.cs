using System.Globalization;

namespace Kooch.Api.Services.Holidays;

internal static class HolidayCalendarSnapshotValidator
{
    internal static IReadOnlyList<HolidayCalendarNormalizedYear> ValidateAndNormalize(
        IReadOnlyCollection<HolidayProviderYear> fetchedYears,
        IReadOnlyList<int> requestedYears,
        string providerName,
        int maximumEventTitleLength)
    {
        if (fetchedYears.Count != requestedYears.Count)
        {
            throw new HolidayCalendarSnapshotValidationException(null);
        }

        var gregorianDates = new HashSet<DateOnly>();
        var solarDates = new HashSet<(int Year, int Month, int Day)>();
        var normalizedYears = new List<HolidayCalendarNormalizedYear>(requestedYears.Count);

        foreach (var requestedYear in requestedYears)
        {
            var matchingYears = fetchedYears.Where(year => year.RequestedSolarYear == requestedYear).ToArray();
            var fetchedYear = matchingYears.Length == 1
                ? matchingYears[0]
                : throw new HolidayCalendarSnapshotValidationException(requestedYear);
            if (fetchedYear.SourceSolarYear != requestedYear ||
                !string.Equals(fetchedYear.ProviderName, providerName, StringComparison.Ordinal))
            {
                throw new HolidayCalendarSnapshotValidationException(requestedYear);
            }

            normalizedYears.Add(ValidateAndNormalizeYear(
                fetchedYear,
                requestedYear,
                maximumEventTitleLength,
                gregorianDates,
                solarDates));
        }

        return normalizedYears;
    }

    internal static string NormalizeTitle(string title) => title.Trim().ToLowerInvariant();

    private static HolidayCalendarNormalizedYear ValidateAndNormalizeYear(
        HolidayProviderYear fetchedYear,
        int requestedYear,
        int maximumEventTitleLength,
        HashSet<DateOnly> gregorianDates,
        HashSet<(int Year, int Month, int Day)> solarDates)
    {
        var holidays = new List<HolidayCalendarNormalizedDay>(fetchedYear.Holidays.Count);
        foreach (var holiday in fetchedYear.Holidays)
        {
            holidays.Add(ValidateAndNormalizeDay(
                holiday,
                requestedYear,
                maximumEventTitleLength,
                gregorianDates,
                solarDates));
        }

        return new HolidayCalendarNormalizedYear(
            requestedYear,
            holidays.OrderBy(holiday => holiday.GregorianDate).ToArray());
    }

    private static HolidayCalendarNormalizedDay ValidateAndNormalizeDay(
        HolidayProviderDay holiday,
        int requestedYear,
        int maximumEventTitleLength,
        HashSet<DateOnly> gregorianDates,
        HashSet<(int Year, int Month, int Day)> solarDates)
    {
        if (holiday.SolarYear != requestedYear ||
            holiday.DayOfWeek != holiday.Date.DayOfWeek ||
            holiday.IsWeeklyHoliday == holiday.IsOfficialHoliday ||
            (holiday.IsWeeklyHoliday && holiday.Date.DayOfWeek != DayOfWeek.Friday) ||
            (holiday.IsOfficialHoliday && holiday.Date.DayOfWeek == DayOfWeek.Friday) ||
            !gregorianDates.Add(holiday.Date) ||
            !solarDates.Add((holiday.SolarYear, holiday.SolarMonth, holiday.SolarDay)))
        {
            throw new HolidayCalendarSnapshotValidationException(requestedYear);
        }

        DateOnly expectedGregorianDate;
        try
        {
            expectedGregorianDate = DateOnly.FromDateTime(new PersianCalendar().ToDateTime(
                holiday.SolarYear, holiday.SolarMonth, holiday.SolarDay, 0, 0, 0, 0));
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new HolidayCalendarSnapshotValidationException(requestedYear);
        }

        if (expectedGregorianDate != holiday.Date ||
            (holiday.IsWeeklyHoliday && holiday.OccasionTitles.Count != 0))
        {
            throw new HolidayCalendarSnapshotValidationException(requestedYear);
        }

        return new HolidayCalendarNormalizedDay(
            holiday.Date,
            holiday.SolarYear,
            holiday.SolarMonth,
            holiday.SolarDay,
            holiday.DayOfWeek,
            holiday.IsWeeklyHoliday,
            holiday.IsOfficialHoliday,
            requestedYear,
            ValidateAndNormalizeOccasions(holiday.OccasionTitles, requestedYear, maximumEventTitleLength));
    }

    private static IReadOnlyList<HolidayCalendarNormalizedOccasion> ValidateAndNormalizeOccasions(
        IReadOnlyList<string> titles,
        int requestedYear,
        int maximumEventTitleLength)
    {
        var occasions = new List<HolidayCalendarNormalizedOccasion>(titles.Count);
        var normalizedTitles = new HashSet<string>(StringComparer.Ordinal);
        foreach (var title in titles)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                throw new HolidayCalendarSnapshotValidationException(requestedYear);
            }

            var trimmedTitle = title.Trim();
            if (trimmedTitle.Length > maximumEventTitleLength)
            {
                throw new HolidayCalendarSnapshotValidationException(requestedYear);
            }

            var normalizedTitle = NormalizeTitle(trimmedTitle);
            if (!normalizedTitles.Add(normalizedTitle))
            {
                throw new HolidayCalendarSnapshotValidationException(requestedYear);
            }

            occasions.Add(new HolidayCalendarNormalizedOccasion(trimmedTitle, normalizedTitle));
        }

        return occasions.OrderBy(occasion => occasion.NormalizedTitle, StringComparer.Ordinal).ToArray();
    }
}

internal sealed record HolidayCalendarNormalizedYear(
    int SolarYear,
    IReadOnlyList<HolidayCalendarNormalizedDay> Holidays);

internal sealed record HolidayCalendarNormalizedDay(
    DateOnly GregorianDate,
    int SolarYear,
    int SolarMonth,
    int SolarDay,
    DayOfWeek DayOfWeek,
    bool IsWeeklyHoliday,
    bool IsOfficialHoliday,
    int SourceSolarYear,
    IReadOnlyList<HolidayCalendarNormalizedOccasion> Occasions);

internal sealed record HolidayCalendarNormalizedOccasion(string Title, string NormalizedTitle);

internal sealed class HolidayCalendarSnapshotValidationException(int? solarYear) : Exception
{
    internal int? SolarYear { get; } = solarYear;
}
