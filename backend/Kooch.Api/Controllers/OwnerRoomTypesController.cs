using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner")]
public class OwnerRoomTypesController(IRoomTypeService roomTypeService) : AuthenticatedControllerBase
{
    [HttpPost("properties/{propertyId:int}/room-types")]
    [ProducesResponseType<RoomTypeResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<RoomTypeResponse>> Create(
        int propertyId,
        CreateRoomTypeRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var roomType = await roomTypeService.CreateRoomTypeAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, roomType);
    }

    [HttpGet("properties/{propertyId:int}/room-types")]
    [ProducesResponseType<IReadOnlyList<RoomTypeResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomTypeResponse>>> GetByProperty(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await roomTypeService.GetRoomTypesByPropertyAsync(
            user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPut("room-types/{id:int}")]
    [ProducesResponseType<RoomTypeResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<RoomTypeResponse>> Update(
        int id,
        UpdateRoomTypeRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await roomTypeService.UpdateRoomTypeAsync(
            user.UserId, user.Role, id, request, cancellationToken));
    }
}
