using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;
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
        CancellationToken cancellationToken,
        [FromQuery] PricingGuestType guestType = PricingGuestType.Iranian)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.GetAsync(user.UserId, user.Role, propertyId, from, to, guestType, cancellationToken));
    }

    [HttpPost("bulk-cells")]
    [ProducesResponseType<IReadOnlyList<RoomDailyPriceResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomDailyPriceResponse>>> BulkUpdate(
        int propertyId, BulkRoomDailyPriceRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.BulkUpdateAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpPost("copy")]
    [ProducesResponseType<IReadOnlyList<RoomDailyPriceResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomDailyPriceResponse>>> Copy(
        int propertyId, CopyRoomDailyPriceRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.CopyAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpGet("history")]
    [ProducesResponseType<IReadOnlyList<RoomDailyPriceHistoryResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomDailyPriceHistoryResponse>>> History(
        int propertyId,
        CancellationToken cancellationToken,
        [FromQuery] PricingGuestType? guestType = null)
    {
        var user = GetCurrentUser();
        return Ok(await pricingService.GetHistoryAsync(user.UserId, user.Role, propertyId, guestType, cancellationToken));
    }
}
