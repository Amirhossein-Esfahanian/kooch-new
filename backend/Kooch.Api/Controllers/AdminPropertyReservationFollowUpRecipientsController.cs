using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/properties/{propertyId:int}/reservation-follow-up-recipients")]
public sealed class AdminPropertyReservationFollowUpRecipientsController(
    IReservationFollowUpRecipientService recipientService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ReservationFollowUpRecipientResponse>>> Get(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        return Ok(await recipientService.GetAsync(
            actor.UserId,
            actor.Role,
            propertyId,
            cancellationToken));
    }

    [HttpGet("candidates")]
    public async Task<ActionResult<IReadOnlyList<ReservationFollowUpCandidateResponse>>> Candidates(
        int propertyId,
        [FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        return Ok(await recipientService.SearchCandidatesAsync(
            actor.UserId,
            actor.Role,
            propertyId,
            search,
            cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ReservationFollowUpRecipientResponse>> Assign(
        int propertyId,
        AssignReservationFollowUpRecipientRequest request,
        CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        var assigned = await recipientService.AssignAsync(
            actor.UserId,
            actor.Role,
            propertyId,
            request.UserId,
            cancellationToken);
        return CreatedAtAction(nameof(Get), new { propertyId }, assigned);
    }

    [HttpDelete("{userId:int}")]
    public async Task<IActionResult> Deactivate(
        int propertyId,
        int userId,
        CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        await recipientService.DeactivateAsync(
            actor.UserId,
            actor.Role,
            propertyId,
            userId,
            cancellationToken);
        return NoContent();
    }
}
