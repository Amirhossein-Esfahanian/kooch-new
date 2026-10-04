using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner")]
public class OwnerRoomTypesController(IRoomTypeService roomTypeService, IRatePlanService ratePlanService) : AuthenticatedControllerBase
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

    [HttpDelete("room-types/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await roomTypeService.DeleteRoomTypeAsync(user.UserId, user.Role, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("properties/{propertyId:int}/room-types/{roomTypeId:int}/rate-plans")]
    public async Task<ActionResult<IReadOnlyList<RatePlanResponse>>> ListRatePlans(
        int propertyId, int roomTypeId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await ratePlanService.ListAsync(user.UserId, user.Role, propertyId, roomTypeId, cancellationToken));
    }

    [HttpGet("properties/{propertyId:int}/room-types/{roomTypeId:int}/rate-plans/{ratePlanId:int}")]
    public async Task<ActionResult<RatePlanResponse>> GetRatePlan(
        int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await ratePlanService.GetAsync(user.UserId, user.Role, propertyId, roomTypeId, ratePlanId, cancellationToken));
    }

    [HttpPost("properties/{propertyId:int}/room-types/{roomTypeId:int}/rate-plans")]
    public async Task<ActionResult<RatePlanResponse>> CreateRatePlan(
        int propertyId, int roomTypeId, CreateRatePlanRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var plan = await ratePlanService.CreateAsync(user.UserId, user.Role, propertyId, roomTypeId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, plan);
    }

    [HttpPut("properties/{propertyId:int}/room-types/{roomTypeId:int}/rate-plans/{ratePlanId:int}")]
    public async Task<ActionResult<RatePlanResponse>> UpdateRatePlan(
        int propertyId, int roomTypeId, int ratePlanId, UpdateRatePlanRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await ratePlanService.UpdateAsync(user.UserId, user.Role, propertyId, roomTypeId, ratePlanId, request, cancellationToken));
    }

    [HttpDelete("properties/{propertyId:int}/room-types/{roomTypeId:int}/rate-plans/{ratePlanId:int}")]
    public async Task<IActionResult> DeleteRatePlan(
        int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await ratePlanService.DeleteAsync(user.UserId, user.Role, propertyId, roomTypeId, ratePlanId, cancellationToken);
        return NoContent();
    }

    [HttpGet("properties/{propertyId:int}/meal-plans")]
    public async Task<ActionResult<IReadOnlyList<MealPlanOptionResponse>>> ListMealPlans(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await ratePlanService.ListMealPlansAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }
}
