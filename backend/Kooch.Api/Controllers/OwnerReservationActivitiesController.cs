using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/reservations/{reservationId:int}/activities")]
public sealed class OwnerReservationActivitiesController(ReservationActivityService activities)
    : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<OwnerReservationActivityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<OwnerReservationActivityResponse>>> List(
        int propertyId, int reservationId, [FromQuery] OwnerReservationActivityQuery query,
        CancellationToken cancellationToken) =>
        Ok(await activities.ListForOwnerAsync(
            propertyId, reservationId, GetCurrentUser().UserId, query, cancellationToken));
}
