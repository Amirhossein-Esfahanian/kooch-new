using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reports;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ViewReports)]
[Route("api/admin/reports")]
public sealed class AdminReportsController(IAdminReportService reportService) : AuthenticatedControllerBase
{
    [HttpGet("reservations")]
    [ProducesResponseType<AdminReservationReportResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminReservationReportResponse>> GetReservations(
        [FromQuery] AdminReservationReportQuery query, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await reportService.GetReservationsAsync(user.UserId, user.Role, query, cancellationToken));
    }
}
