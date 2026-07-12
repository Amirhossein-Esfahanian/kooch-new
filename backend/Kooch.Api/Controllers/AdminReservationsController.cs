using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/reservations")]
public class AdminReservationsController(
    IReservationService reservationService,
    IReservationPricingService reservationPricingService,
    IReservationAvailabilityService reservationAvailabilityService,
    IReservationRulesResolver reservationRulesResolver) : AuthenticatedControllerBase
{
    [HttpGet("effective-rules")]
    [ProducesResponseType<EffectiveReservationRules>(StatusCodes.Status200OK)]
    public async Task<ActionResult<EffectiveReservationRules>> GetEffectiveRules(
        [FromQuery] int propertyId,
        [FromQuery] int roomTypeId,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationRulesResolver.ResolveAsync(propertyId, roomTypeId, cancellationToken));
    }

    [HttpGet("available-rooms")]
    [ProducesResponseType<IReadOnlyList<AvailableRoomResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AvailableRoomResponse>>> GetAvailableRooms(
        [FromQuery] int propertyId,
        [FromQuery] DateOnly checkInDate,
        [FromQuery] DateOnly checkOutDate,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationAvailabilityService.GetAvailableRoomsAsync(
            propertyId,
            checkInDate,
            checkOutDate,
            cancellationToken));
    }

    [HttpGet]
    [ProducesResponseType<PagedResult<ReservationListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReservationListItemResponse>>> GetAll(
        [FromQuery] ReservationListQuery query,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.SearchAsync(query, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> GetById(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.GetByIdAsync(id, cancellationToken: cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ReservationResponse>> Create(
        ReservationCreateRequest request,
        CancellationToken cancellationToken)
    {
        var reservation = await reservationService.CreateAsync(request, GetCurrentUser(), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = reservation.Id }, reservation);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Update(
        int id,
        ReservationUpdateRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.UpdateAsync(id, request, GetCurrentUser(), cancellationToken));
    }

    [HttpPost("price-preview")]
    [ProducesResponseType<ReservationPricePreviewResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPricePreviewResponse>> PreviewPrice(
        ReservationPricePreviewRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationPricingService.PreviewReservationPriceAsync(request, cancellationToken));
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Approve(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.ApproveAsync(id, GetCurrentUser(), cancellationToken));
    }

    [HttpPut("{id:int}/cancel")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Cancel(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.CancelAsync(id, GetCurrentUser(), cancellationToken));
    }

    [HttpPut("{id:int}/status")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> UpdateStatus(
        int id,
        ReservationStatusUpdateRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.UpdateStatusAsync(id, request, GetCurrentUser(), cancellationToken));
    }

    [HttpPost("{id:int}/payment-link")]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> GeneratePaymentLink(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.GeneratePaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }

    [HttpPost("{id:int}/payment-link/send")]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> SendPaymentLink(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.SendPaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }
}
