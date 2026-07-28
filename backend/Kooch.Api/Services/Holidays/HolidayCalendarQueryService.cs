using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Calendar;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Holidays;

public sealed class HolidayCalendarQueryService(
    KoochDbContext dbContext,
    IOptions<HolidayCalendarSynchronizationOptions> options,
    ILogger<HolidayCalendarQueryService> logger) : IHolidayCalendarQueryService
{
    private static readonly PersianCalendar PersianCalendar = new();
    private readonly HolidayCalendarSynchronizationOptions synchronizationOptions = options.Value;

    public async Task<HolidayCalendarDaysResponse> GetDaysAsync(
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default)
    {
        var storedDays = await dbContext.HolidayCalendarDays
            .AsNoTracking()
            .Where(day => day.GregorianDate >= from && day.GregorianDate <= to)
            .OrderBy(day => day.GregorianDate)
            .Select(day => new StoredHolidayDay(
                day.GregorianDate,
                day.SolarYear,
                day.SolarMonth,
                day.SolarDay,
                day.IsWeeklyHoliday,
                day.IsOfficialHoliday,
                day.Override == null ? null : day.Override.IsWeeklyHoliday,
                day.Override == null ? null : day.Override.IsOfficialHoliday,
                day.Occasions
                    .Select(occasion => new StoredOccasion(occasion.Title, occasion.NormalizedTitle))
                    .ToArray()))
            .ToListAsync(cancellationToken);

        var syncState = await dbContext.HolidayCalendarSyncStates
            .AsNoTracking()
            .Where(state => state.ProviderName == synchronizationOptions.ProviderName)
            .Select(state => new SyncCoverage(
                state.LastSuccessfulSyncAtUtc,
                state.LastSuccessfulSolarYearFrom,
                state.LastSuccessfulSolarYearTo))
            .SingleOrDefaultAsync(cancellationToken);

        var days = new List<HolidayCalendarDayResponse>(storedDays.Count);
        foreach (var storedDay in storedDays)
        {
            var isWeeklyHoliday = storedDay.OverrideIsWeeklyHoliday ?? storedDay.IsWeeklyHoliday;
            var isOfficialHoliday = storedDay.OverrideIsOfficialHoliday ?? storedDay.IsOfficialHoliday;
            if (isWeeklyHoliday && isOfficialHoliday)
            {
                logger.LogError(
                    "Holiday calendar date {GregorianDate} has an invalid effective classification.",
                    storedDay.Date);
                throw new InvalidOperationException(
                    "Holiday calendar data contains an invalid effective classification.");
            }

            if (!isWeeklyHoliday && !isOfficialHoliday)
            {
                continue;
            }

            days.Add(new HolidayCalendarDayResponse(
                storedDay.Date,
                storedDay.SolarYear,
                storedDay.SolarMonth,
                storedDay.SolarDay,
                isWeeklyHoliday,
                isOfficialHoliday,
                BuildOccasionTitles(storedDay.Occasions)));
        }

        var requestedSolarYearFrom = GetSolarYear(from);
        var requestedSolarYearTo = GetSolarYear(to);
        var isRangeFullyCovered = syncState is
            {
                LastSuccessfulSyncAtUtc: not null,
                CoveredSolarYearFrom: not null,
                CoveredSolarYearTo: not null
            } &&
            requestedSolarYearFrom >= syncState.CoveredSolarYearFrom.Value &&
            requestedSolarYearTo <= syncState.CoveredSolarYearTo.Value;

        return new HolidayCalendarDaysResponse(
            from,
            to,
            isRangeFullyCovered,
            syncState?.CoveredSolarYearFrom,
            syncState?.CoveredSolarYearTo,
            syncState?.LastSuccessfulSyncAtUtc,
            days);
    }

    private static int GetSolarYear(DateOnly date) =>
        PersianCalendar.GetYear(date.ToDateTime(TimeOnly.MinValue));

    private static IReadOnlyList<string> BuildOccasionTitles(IEnumerable<StoredOccasion> occasions) =>
        occasions
            .Where(occasion => !string.IsNullOrWhiteSpace(occasion.Title))
            .GroupBy(
                occasion => HolidayCalendarSnapshotValidator.NormalizeTitle(occasion.NormalizedTitle),
                StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => group
                .Select(occasion => occasion.Title.Trim())
                .OrderBy(title => title, StringComparer.Ordinal)
                .First())
            .ToArray();

    private sealed record StoredHolidayDay(
        DateOnly Date,
        int SolarYear,
        int SolarMonth,
        int SolarDay,
        bool IsWeeklyHoliday,
        bool IsOfficialHoliday,
        bool? OverrideIsWeeklyHoliday,
        bool? OverrideIsOfficialHoliday,
        IReadOnlyList<StoredOccasion> Occasions);

    private sealed record StoredOccasion(string Title, string NormalizedTitle);

    private sealed record SyncCoverage(
        DateTime? LastSuccessfulSyncAtUtc,
        int? CoveredSolarYearFrom,
        int? CoveredSolarYearTo);
}
