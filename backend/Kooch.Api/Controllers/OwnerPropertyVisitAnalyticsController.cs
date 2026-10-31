using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/visits/analytics")]
public sealed class OwnerPropertyVisitAnalyticsController(
    OwnerPropertyVisitAnalyticsService analyticsService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<OwnerPropertyVisitAnalyticsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<OwnerPropertyVisitAnalyticsResponse>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(
                user.UserId, propertyId, "reports.view", cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot view reports for this property.");
        }

        return Ok(await analyticsService.GetAsync(propertyId, cancellationToken));
    }
}
