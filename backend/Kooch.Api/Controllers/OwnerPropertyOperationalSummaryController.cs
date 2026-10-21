using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/reservations/operational-summary")]
public sealed class OwnerPropertyOperationalSummaryController(
    OwnerPropertyOperationalSummaryService summaryService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<OwnerPropertyOperationalSummaryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<OwnerPropertyOperationalSummaryResponse>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(
                user.UserId, propertyId, "bookings.view", cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property's reservations.");
        }

        return Ok(await summaryService.GetAsync(propertyId, cancellationToken));
    }
}
