using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/reservations/{reservationId:int}/voucher")]
public sealed class OwnerReservationVouchersController(
    IReservationVoucherQueryService voucherQueryService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<OwnerReservationVoucherResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<OwnerReservationVoucherResponse>> Get(
        int propertyId,
        int reservationId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await voucherQueryService.GetForPropertyAsync(
            user.UserId,
            propertyId,
            reservationId,
            cancellationToken));
    }
}
