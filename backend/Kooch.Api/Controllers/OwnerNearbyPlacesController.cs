using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
public class OwnerNearbyPlacesController(INearbyPlaceService nearbyPlaceService)
    : AuthenticatedControllerBase
{
    [HttpGet("api/owner/properties/{propertyId:int}/nearby-places")]
    public async Task<ActionResult<IReadOnlyList<NearbyPlaceResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await nearbyPlaceService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost("api/owner/properties/{propertyId:int}/nearby-places")]
    public async Task<ActionResult<NearbyPlaceResponse>> Create(
        int propertyId, NearbyPlaceRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var place = await nearbyPlaceService.CreateAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, place);
    }

    [HttpPut("api/owner/nearby-places/{nearbyPlaceId:int}")]
    public async Task<ActionResult<NearbyPlaceResponse>> Update(
        int nearbyPlaceId, NearbyPlaceRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await nearbyPlaceService.UpdateAsync(
            user.UserId, user.Role, nearbyPlaceId, request, cancellationToken));
    }
}
