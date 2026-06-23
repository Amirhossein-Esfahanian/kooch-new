using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/promotions")]
public sealed class AdminPromotionsController(IPromotionService promotionService) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PromotionResponse>>> Get(CancellationToken cancellationToken) =>
        Ok(await promotionService.GetAllForAdminAsync(cancellationToken));

    [HttpPost]
    public async Task<ActionResult<PromotionResponse>> Create(PromotionUpsertRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var result = await promotionService.CreateAsync(user.UserId, user.Role, null, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, result);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<PromotionResponse>> Update(int id, PromotionUpsertRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await promotionService.UpdateAsync(user.UserId, user.Role, null, id, request, cancellationToken));
    }

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<PromotionResponse>> SetStatus(int id, PromotionStatusRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await promotionService.SetActiveAsync(user.UserId, user.Role, null, id, request.IsActive, cancellationToken));
    }

    [HttpPost("{id:int}/duplicate")]
    public async Task<ActionResult<PromotionResponse>> Duplicate(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return StatusCode(StatusCodes.Status201Created,
            await promotionService.DuplicateAsync(user.UserId, user.Role, null, id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await promotionService.DeleteAsync(user.UserId, user.Role, null, id, cancellationToken);
        return NoContent();
    }

    [HttpPut("sort-order")]
    public async Task<IActionResult> Reorder(PromotionSortRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await promotionService.ReorderAsync(user.UserId, user.Role, null, request.PromotionIds, cancellationToken);
        return NoContent();
    }
}
