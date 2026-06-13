using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/room-types/{roomTypeId:int}/rooms")]
public class OwnerRoomsController(IRoomService roomService) : AuthenticatedControllerBase
{
    [HttpPost]
    [ProducesResponseType<RoomResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<RoomResponse>> Create(
        int roomTypeId,
        CreateRoomRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var room = await roomService.CreateRoomAsync(
            user.UserId, user.Role, roomTypeId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, room);
    }

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<RoomResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomResponse>>> GetByRoomType(
        int roomTypeId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await roomService.GetRoomsByRoomTypeAsync(
            user.UserId, user.Role, roomTypeId, cancellationToken));
    }
}
