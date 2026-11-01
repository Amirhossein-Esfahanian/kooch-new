using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/inventory/today-summary")]
public sealed class OwnerPropertyDailyInventorySummaryController(
    OwnerPropertyDailyInventorySummaryService summaryService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<OwnerPropertyDailyInventorySummaryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<OwnerPropertyDailyInventorySummaryResponse>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(user.UserId, propertyId, "reports.view", cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot view reports for this property.");
        }

        return Ok(await summaryService.GetAsync(propertyId, cancellationToken));
    }
}
