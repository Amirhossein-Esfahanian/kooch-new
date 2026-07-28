using System.Globalization;
using Kooch.Api.Dtos.Calendar;
using Kooch.Api.Services.Holidays;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/calendar")]
public sealed class CalendarController(IHolidayCalendarQueryService holidayCalendarQueryService) : ControllerBase
{
    internal const int MaximumInclusiveRangeDays = 93;

    [HttpGet("days")]
    [ProducesResponseType<HolidayCalendarDaysResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<HolidayCalendarDaysResponse>> GetDays(
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken cancellationToken)
    {
        if (!TryParseIsoDate(from, out var fromDate) || !TryParseIsoDate(to, out var toDate))
        {
            return BadRequest(new { message = "from and to must be valid dates in YYYY-MM-DD format." });
        }

        if (fromDate > toDate)
        {
            return BadRequest(new { message = "from must be on or before to." });
        }

        if (toDate.DayNumber - fromDate.DayNumber + 1 > MaximumInclusiveRangeDays)
        {
            return BadRequest(new { message = $"The inclusive date range cannot exceed {MaximumInclusiveRangeDays} days." });
        }

        return Ok(await holidayCalendarQueryService.GetDaysAsync(fromDate, toDate, cancellationToken));
    }

    private static bool TryParseIsoDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(
            value,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out date);
}
