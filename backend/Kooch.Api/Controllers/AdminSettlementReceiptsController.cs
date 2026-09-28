using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/settlements/{settlementNumber}/receipt")]
public sealed class AdminSettlementReceiptsController(SettlementReceiptQueryService receipts) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<AdminSettlementReceiptResponse>> Get(string settlementNumber,
        CancellationToken cancellationToken) =>
        Ok(await receipts.GetForAdminAsync(settlementNumber, cancellationToken));
}
