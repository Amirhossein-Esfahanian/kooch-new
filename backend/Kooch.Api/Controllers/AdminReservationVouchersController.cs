using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/reservations/{reservationId:int}/voucher")]
public sealed class AdminReservationVouchersController(IReservationVoucherQueryService voucherQueryService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<OwnerReservationVoucherResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<OwnerReservationVoucherResponse>> Get(
        int reservationId,
        CancellationToken cancellationToken) =>
        Ok(await voucherQueryService.GetForAdminAsync(reservationId, cancellationToken));
}
