using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/booking-sessions")]
public sealed class AccountBookingSessionsController(
    IBookingSessionService bookingSessionService,
    IBookingSessionQueryService bookingSessionQueryService) : AuthenticatedControllerBase
{
    [HttpPost]
    [ProducesResponseType<AccountBookingSessionCreateResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AccountBookingSessionCreateResponse>> Create(
        [FromBody] AccountBookingSessionCreateRequest request,
        CancellationToken cancellationToken)
    {
        var currentUser = GetCurrentUser();
        var result = await bookingSessionService.CreateForAccountAsync(
            currentUser.UserId,
            request,
            cancellationToken);
        var response = new AccountBookingSessionCreateResponse
        {
            BookingSessionId = result.BookingSessionId,
            SessionCode = result.SessionCode,
            PropertyId = result.PropertyId,
            Currency = result.Currency,
            Reservations = result.Reservations
        };
        return CreatedAtAction(
            nameof(GetBySessionCode),
            new { sessionCode = result.SessionCode },
            response);
    }

    [HttpGet("{sessionCode}")]
    [ProducesResponseType<AccountBookingSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AccountBookingSessionResponse>> GetBySessionCode(
        string sessionCode,
        CancellationToken cancellationToken)
    {
        var currentUser = GetCurrentUser();
        return Ok(await bookingSessionQueryService.GetBySessionCodeForClientAsync(
            currentUser.UserId,
            sessionCode,
            cancellationToken));
    }
}
