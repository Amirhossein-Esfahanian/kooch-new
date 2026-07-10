using Kooch.Api.Dtos.Payments;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/account/reservations/{reservationNumber}/payment")]
public class AccountReservationPaymentsController(IPaymentService paymentService) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<ReservationPaymentPreparationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentPreparationResponse>> GetPreparation(
        string reservationNumber,
        [FromQuery] string? token,
        CancellationToken cancellationToken)
    {
        return Ok(await paymentService.GetReservationPaymentPreparationAsync(
            reservationNumber,
            token,
            cancellationToken));
    }

    [HttpPost("continue")]
    [ProducesResponseType<ReservationPaymentPlaceholderResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentPlaceholderResponse>> Continue(
        string reservationNumber,
        [FromQuery] string? token,
        CancellationToken cancellationToken)
    {
        return Ok(await paymentService.ContinueReservationPaymentAsync(
            reservationNumber,
            token,
            cancellationToken));
    }
}
