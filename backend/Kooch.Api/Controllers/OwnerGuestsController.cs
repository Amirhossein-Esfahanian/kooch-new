using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/guests")]
public class OwnerGuestsController(
    IGuestService guestService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<GuestResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<GuestResponse>>> Search(
        int propertyId,
        [FromQuery] GuestSearchRequest query,
        CancellationToken cancellationToken)
    {
        await EnsureCanViewAsync(propertyId, cancellationToken);

        // Guests are not property-scoped until reservations connect guests to properties.
        return Ok(Array.Empty<GuestResponse>());
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<GuestResponse>> GetById(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        await EnsureCanViewAsync(propertyId, cancellationToken);
        return Ok(await guestService.GetAsync(id, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<GuestResponse>> Create(
        int propertyId,
        GuestCreateRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanEditBookingsAsync(propertyId, cancellationToken);
        var guest = await guestService.CreateAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, guest);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<GuestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<GuestResponse>> Update(
        int propertyId,
        int id,
        GuestUpdateRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanEditBookingsAsync(propertyId, cancellationToken);
        return Ok(await guestService.UpdateAsync(id, request, cancellationToken));
    }

    private async Task EnsureCanViewAsync(int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(user.UserId, propertyId, "bookings.view", cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property's guests.");
        }
    }

    private async Task EnsureCanEditBookingsAsync(int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(user.UserId, propertyId, "bookings.edit", cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property's guests.");
        }
    }
}
