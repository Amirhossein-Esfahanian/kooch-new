namespace Kooch.Api.Services.Holidays;

public interface IHolidayProvider
{
    Task<HolidayProviderYear> FetchYearAsync(
        int solarHijriYear,
        CancellationToken cancellationToken = default);
}
