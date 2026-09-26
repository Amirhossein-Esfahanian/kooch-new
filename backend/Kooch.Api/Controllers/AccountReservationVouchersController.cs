using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/reservations/{reservationNumber}/voucher")]
public sealed class AccountReservationVouchersController(
    IReservationVoucherQueryService voucherQueryService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<GuestReservationVoucherResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<GuestReservationVoucherResponse>> Get(
        string reservationNumber,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await voucherQueryService.GetForGuestAsync(
            user.UserId,
            reservationNumber,
            cancellationToken));
    }
}
