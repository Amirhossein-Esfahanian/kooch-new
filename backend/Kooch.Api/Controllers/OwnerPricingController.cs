using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/pricing")]
public class OwnerPricingController(IRoomDailyPriceService pricingService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PropertyPricingResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyPricingResponse>> Get(
        int propertyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.GetAsync(user.UserId, user.Role, propertyId, from, to, cancellationToken));
    }

    [HttpPost("bulk-cells")]
    [ProducesResponseType<IReadOnlyList<RoomDailyPriceResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomDailyPriceResponse>>> BulkUpdate(
        int propertyId, BulkRoomDailyPriceRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.BulkUpdateAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }
}
