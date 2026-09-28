using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/settlements/{settlementNumber}/receipt")]
public sealed class OwnerSettlementReceiptsController(SettlementReceiptQueryService receipts) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PropertySettlementReceiptResponse>> Get(int propertyId, string settlementNumber,
        CancellationToken cancellationToken) =>
        Ok(await receipts.GetForPropertyAsync(GetCurrentUser().UserId, propertyId, settlementNumber, cancellationToken));
}
