using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/rooms")]
public sealed class OwnerPropertyRoomsController(IRoomService roomService) : AuthenticatedControllerBase
{
    [HttpPost]
    [ProducesResponseType<OwnerRoomResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<OwnerRoomResponse>> Create(
        int propertyId,
        CreatePropertyRoomRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var room = await roomService.CreatePropertyRoomAsync(
            user.UserId,
            user.Role,
            propertyId,
            request,
            cancellationToken);
        return StatusCode(StatusCodes.Status201Created, room);
    }

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<OwnerRoomResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<OwnerRoomResponse>>> GetByProperty(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await roomService.GetRoomsByPropertyAsync(
            user.UserId,
            user.Role,
            propertyId,
            cancellationToken));
    }
}
