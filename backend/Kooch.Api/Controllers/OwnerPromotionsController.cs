using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/promotions")]
public sealed class OwnerPromotionsController(IPromotionService promotionService) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PromotionResponse>>> Get(int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await promotionService.GetByPropertyAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<PromotionResponse>> Create(int propertyId, PromotionUpsertRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var result = await promotionService.CreateAsync(user.UserId, user.Role, propertyId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, result);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<PromotionResponse>> Update(int propertyId, int id, PromotionUpsertRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await promotionService.UpdateAsync(user.UserId, user.Role, propertyId, id, request, cancellationToken));
    }

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<PromotionResponse>> SetStatus(int propertyId, int id, PromotionStatusRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await promotionService.SetActiveAsync(user.UserId, user.Role, propertyId, id, request.IsActive, cancellationToken));
    }

    [HttpPost("{id:int}/duplicate")]
    public async Task<ActionResult<PromotionResponse>> Duplicate(int propertyId, int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return StatusCode(StatusCodes.Status201Created,
            await promotionService.DuplicateAsync(user.UserId, user.Role, propertyId, id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int propertyId, int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await promotionService.DeleteAsync(user.UserId, user.Role, propertyId, id, cancellationToken);
        return NoContent();
    }

    [HttpPut("sort-order")]
    public async Task<IActionResult> Reorder(int propertyId, PromotionSortRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await promotionService.ReorderAsync(user.UserId, user.Role, propertyId, request.PromotionIds, cancellationToken);
        return NoContent();
    }
}
