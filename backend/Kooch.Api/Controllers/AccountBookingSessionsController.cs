using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/booking-sessions")]
public sealed class AccountBookingSessionsController(
    IBookingSessionService bookingSessionService,
    IBookingSessionQueryService bookingSessionQueryService,
    IAccountBookingSessionPaymentService paymentService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<AccountBookingSessionListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<AccountBookingSessionListItemResponse>>> GetMine(
        [FromQuery] AccountBookingSessionListQuery query,
        CancellationToken cancellationToken)
    {
        var currentUser = GetCurrentUser();
        return Ok(await bookingSessionQueryService.GetForClientAsync(
            currentUser.UserId,
            query,
            cancellationToken));
    }

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

    [HttpGet("payment-providers")]
    [ProducesResponseType<IReadOnlyList<AccountPaymentProviderOptionResponse>>(
        StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<AccountPaymentProviderOptionResponse>> GetPaymentProviders()
    {
        return Ok(paymentService.GetSelectableProviders());
    }

    [HttpPost("{sessionCode}/payments")]
    [ProducesResponseType<AccountBookingSessionPaymentInitiationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<AccountBookingSessionPaymentInitiationResponse>> InitiatePayment(
        string sessionCode,
        [FromBody] AccountBookingSessionPaymentRequest request,
        CancellationToken cancellationToken)
    {
        var currentUser = GetCurrentUser();
        return Ok(await paymentService.InitiateAsync(
            currentUser.UserId,
            sessionCode,
            request.ProviderKey,
            request.IdempotencyKey,
            cancellationToken));
    }
}
