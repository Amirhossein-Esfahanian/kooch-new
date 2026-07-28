namespace Kooch.Api.Services.Holidays;

public interface IHolidayCalendarSynchronizationService
{
    Task<HolidayCalendarSynchronizationResult> SyncYearAsync(
        int solarYear,
        CancellationToken cancellationToken = default);

    Task<HolidayCalendarSynchronizationResult> SyncWindowAsync(
        int currentSolarYear,
        int yearsAhead,
        CancellationToken cancellationToken = default);
}
