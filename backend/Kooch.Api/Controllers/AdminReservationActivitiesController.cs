using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/reservations/{reservationId:int}/activities")]
public sealed class AdminReservationActivitiesController(ReservationActivityService activities)
    : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<ReservationActivityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReservationActivityResponse>>> List(
        int reservationId, CancellationToken cancellationToken) =>
        Ok(await activities.ListForAdminAsync(reservationId, GetCurrentUser().UserId, cancellationToken));

    [HttpPost("internal-notes")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationActivityResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ReservationActivityResponse>> CreateInternalNote(
        int reservationId, CreateReservationInternalNoteRequest request, CancellationToken cancellationToken)
    {
        var activity = await activities.CreateInternalNoteAsync(
            reservationId, GetCurrentUser().UserId, request.Details, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, activity);
    }
}
