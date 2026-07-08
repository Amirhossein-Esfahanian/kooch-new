using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/reservations")]
public class AdminReservationsController(IReservationService reservationService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<ReservationListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReservationListItemResponse>>> GetAll(
        [FromQuery] ReservationListQuery query,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.SearchAsync(query, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> GetById(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.GetByIdAsync(id, cancellationToken: cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ReservationResponse>> Create(
        ReservationCreateRequest request,
        CancellationToken cancellationToken)
    {
        var reservation = await reservationService.CreateAsync(request, GetCurrentUser(), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = reservation.Id }, reservation);
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Approve(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.ApproveAsync(id, GetCurrentUser(), cancellationToken));
    }
}
