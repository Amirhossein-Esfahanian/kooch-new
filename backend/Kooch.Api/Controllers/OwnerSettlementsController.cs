using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/settlements")]
public sealed class OwnerSettlementsController(PropertySettlementHistoryService service) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<PropertySettlementHistoryItemResponse>>> List(int propertyId,
        [FromQuery] PropertySettlementHistoryQuery query, CancellationToken cancellationToken) =>
        Ok(await service.ListAsync(GetCurrentUser().UserId, propertyId, query, cancellationToken));

    [HttpGet("{settlementNumber}")]
    public async Task<ActionResult<PropertySettlementHistoryDetailResponse>> Get(int propertyId,
        string settlementNumber, CancellationToken cancellationToken) =>
        Ok(await service.GetAsync(GetCurrentUser().UserId, propertyId, settlementNumber, cancellationToken));
}
