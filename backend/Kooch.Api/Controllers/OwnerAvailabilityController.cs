using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/room-types/{roomTypeId:int}/availability")]
public class OwnerAvailabilityController(IAvailabilityService availabilityService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<AvailabilityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AvailabilityResponse>>> Get(
        int roomTypeId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.GetAsync(
            user.UserId, user.Role, roomTypeId, from, to, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<IReadOnlyList<AvailabilityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AvailabilityResponse>>> Set(
        int roomTypeId,
        SetAvailabilityRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.SetAsync(
            user.UserId, user.Role, roomTypeId, request, cancellationToken));
    }
}
