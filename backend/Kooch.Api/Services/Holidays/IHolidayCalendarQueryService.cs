using Kooch.Api.Dtos.Calendar;

namespace Kooch.Api.Services.Holidays;

public interface IHolidayCalendarQueryService
{
    Task<HolidayCalendarDaysResponse> GetDaysAsync(
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default);
}
