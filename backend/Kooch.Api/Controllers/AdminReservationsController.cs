using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
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
    IReservationRulesResolver reservationRulesResolver,
    IPermissionService permissionService,
    ReservationCancellationRequestService cancellationRequestService,
    ManualBookingAvailabilityService? manualBookingAvailability = null) : AuthenticatedControllerBase
{
    [HttpGet("effective-rules")]
    [ProducesResponseType<EffectiveReservationRules>(StatusCodes.Status200OK)]
    public async Task<ActionResult<EffectiveReservationRules>> GetEffectiveRules(
        [FromQuery] int propertyId,
        [FromQuery] int roomTypeId,
        CancellationToken cancellationToken)
    {
        await EnsurePropertyPermissionAsync(propertyId, "bookings.view", cancellationToken);
        return Ok(await reservationRulesResolver.ResolveAsync(propertyId, roomTypeId, cancellationToken));
    }

    /// <summary>Legacy edit lookup returns room records; forCreation=true returns typed options and exclusion reasons.</summary>
    [HttpGet("available-rooms")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAvailableRooms(
        [FromQuery] int propertyId,
        [FromQuery] DateOnly checkInDate,
        [FromQuery] DateOnly checkOutDate,
        [FromQuery] int? excludeReservationId,
        CancellationToken cancellationToken,
        [FromQuery] bool forCreation = false,
        [FromQuery] PricingGuestType guestType = PricingGuestType.Iranian)
    {
        await EnsurePropertyPermissionAsync(propertyId, "bookings.view", cancellationToken);
        if (forCreation)
            return Ok(await (manualBookingAvailability ?? throw new InvalidOperationException("Manual availability is not configured."))
                .GetAsync(propertyId, checkInDate, checkOutDate, guestType, cancellationToken));
        return Ok(await reservationAvailabilityService.GetAvailableRoomsAsync(
            propertyId,
            checkInDate,
            checkOutDate,
            excludeReservationId,
            cancellationToken));
    }

    [HttpGet]
    [ProducesResponseType<PagedResult<ReservationListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReservationListItemResponse>>> GetAll(
        [FromQuery] ReservationListQuery query,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.SearchAsync(query, GetCurrentUser(), cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> GetById(
        int id,
        CancellationToken cancellationToken)
    {
        var response = await reservationService.GetByIdAsync(id, cancellationToken: cancellationToken);
        await EnsurePropertyPermissionAsync(response.PropertyId, "bookings.view", cancellationToken);
        await reservationService.ApplyAdminOrderSummaryAsync(response, GetCurrentUser(), cancellationToken);
        response.CancellationRequest = await cancellationRequestService.GetLatestForAdminAsync(id, cancellationToken);
        if (await permissionService.HasPermissionAsync(
                GetCurrentUser().UserId, PermissionKey.ManagePayments, cancellationToken: cancellationToken))
            response.CancellationFinancial = await reservationService.GetCancellationFinancialStateAsync(id, cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
    }

    [HttpPut("{id:int}/cancellation-request/reject")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<AdminReservationCancellationRequestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminReservationCancellationRequestResponse>> RejectCancellationRequest(
        int id, RejectReservationCancellationRequest request, CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        return Ok(await cancellationRequestService.RejectAsync(
            id, actor.UserId, actor.Role, request.Note, cancellationToken));
    }

    [HttpPost("{id:int}/cancellation-request")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<AdminReservationCancellationRequestResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminReservationCancellationRequestResponse>> CreateCancellationRequest(
        int id, CreateReservationCancellationRequest request, CancellationToken cancellationToken)
    {
        var actor = GetCurrentUser();
        return Ok(await cancellationRequestService.CreateForSupportAsync(
            id, actor.UserId, actor.Role, request, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<ManualBookingCreateResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ManualBookingCreateResponse>> Create(
        ReservationCreateRequest request,
        CancellationToken cancellationToken)
    {
        var order = await reservationService.CreateAsync(request, GetCurrentUser(), cancellationToken);
        return StatusCode(StatusCodes.Status201Created, order);
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
        await EnsurePropertyPermissionAsync(request.PropertyId, "bookings.create", cancellationToken);
        return Ok(request.RoomCount == 1 && !request.ForManualCreation
            ? await reservationPricingService.PreviewReservationPriceAsync(request, cancellationToken)
            : await reservationService.PreviewManualBookingPriceAsync(request, cancellationToken));
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Approve(
        int id,
        CancellationToken cancellationToken)
    {
        var response = await reservationService.ApproveAsync(id, GetCurrentUser(), cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
    }

    [HttpPut("{id:int}/prepare-payment")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> PreparePayment(int id, CancellationToken cancellationToken)
    {
        var response = await reservationService.PrepareManualPaymentAsync(id, GetCurrentUser(), cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
    }

    [HttpPut("{id:int}/cancel")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Cancel(
        int id,
        ReservationCancellationRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await reservationService.CancelAsync(id, request, GetCurrentUser(), cancellationToken);
            return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
        }
        catch (InvalidOperationException error) when (error.Message.StartsWith("PostSettlementNettingRequired:", StringComparison.Ordinal))
        {
            return Conflict(new { code = "PostSettlementNettingRequired", message = error.Message });
        }
    }

    [HttpPut("{id:int}/price-adjustment")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> AdjustPrice(
        int id,
        ReservationPriceAdjustmentRequest request,
        CancellationToken cancellationToken)
    {
        var response = await reservationService.AdjustPriceAsync(
            id,
            request,
            GetCurrentUser(),
            cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
    }

    [HttpPut("{id:int}/status")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> UpdateStatus(
        int id,
        ReservationStatusUpdateRequest request,
        CancellationToken cancellationToken)
    {
        var response = await reservationService.UpdateStatusAsync(id, request, GetCurrentUser(), cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(response, cancellationToken));
    }

    [HttpPost("{id:int}/payment-link")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> GeneratePaymentLink(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.GeneratePaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }

    [HttpPost("{id:int}/payment-link/send")]
    [PermissionAuthorize(PermissionKey.ManageReservations)]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> SendPaymentLink(
        int id,
        CancellationToken cancellationToken)
    {
        return Ok(await reservationService.SendPaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }

    private async Task<ReservationResponse> FilterStatusTransitionsAsync(
        ReservationResponse response,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var canManageReservations = await permissionService.CanAsync(
            user.UserId,
            response.PropertyId,
            "bookings.edit",
            cancellationToken);
        if (!canManageReservations)
        {
            response.AllowedStatusTransitions = response.Status == ReservationStatus.PendingApproval
                ? response.AllowedStatusTransitions
                    .Where(status => status == ReservationStatus.ApprovedAwaitingPayment)
                    .ToList()
                : [];
        }

        await reservationService.ApplyAdminManualPaymentActionsAsync(response, user, cancellationToken);
        return response;
    }

    private async Task EnsurePropertyPermissionAsync(
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(
                user.UserId,
                propertyId,
                permissionKey,
                cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property's reservations.");
        }
    }
}
