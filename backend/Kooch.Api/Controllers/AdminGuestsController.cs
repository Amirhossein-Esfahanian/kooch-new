using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManageGuests)]
[Route("api/admin/guests")]
public class AdminGuestsController(IGuestService guestService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<GuestResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<GuestResponse>>> Search(
        [FromQuery] GuestSearchRequest query,
        CancellationToken cancellationToken)
    {
        return Ok(await guestService.SearchAsync(query, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<GuestResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await guestService.GetAsync(id, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<GuestResponse>> Create(
        GuestCreateRequest request,
        CancellationToken cancellationToken)
    {
        var guest = await guestService.CreateAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = guest.Id }, guest);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<GuestResponse>> Update(
        int id,
        GuestUpdateRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await guestService.UpdateAsync(id, request, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await guestService.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
