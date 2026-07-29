using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/reservations")]
public class AccountReservationsController(IReservationService reservationService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<ReservationListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReservationListItemResponse>>> GetMine(
        [FromQuery] ReservationListQuery query,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await reservationService.SearchByGuestUserAsync(user.UserId, query, cancellationToken));
    }

    [HttpGet("{reservationNumber}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> GetById(
        string reservationNumber,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await reservationService.GetByNumberForGuestUserAsync(user.UserId, reservationNumber, cancellationToken));
    }
}
