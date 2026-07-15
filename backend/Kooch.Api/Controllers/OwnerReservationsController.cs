using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/reservations")]
public class OwnerReservationsController(
    IReservationService reservationService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<ReservationListItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReservationListItemResponse>>> GetByProperty(
        int propertyId,
        [FromQuery] ReservationListQuery query,
        CancellationToken cancellationToken)
    {
        await EnsurePermissionAsync(propertyId, "bookings.view", cancellationToken);
        return Ok(await reservationService.SearchByPropertyAsync(propertyId, query, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> GetById(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        await EnsurePermissionAsync(propertyId, "bookings.view", cancellationToken);
        var response = await reservationService.GetByIdAsync(id, propertyId, cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(propertyId, response, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status201Created)]
    public ActionResult<ReservationResponse> Create(
        int propertyId,
        ReservationCreateRequest request,
        CancellationToken cancellationToken)
    {
        throw new UnauthorizedAccessException("Only admin users can manually create reservations.");
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> Approve(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        await EnsureStatusPermissionAsync(propertyId, cancellationToken);
        await reservationService.GetByIdAsync(id, propertyId, cancellationToken);
        var response = await reservationService.ApproveAsync(id, GetCurrentUser(), cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(propertyId, response, cancellationToken));
    }

    [HttpPut("{id:int}/status")]
    [ProducesResponseType<ReservationResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationResponse>> UpdateStatus(
        int propertyId,
        int id,
        ReservationStatusUpdateRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureStatusPermissionAsync(propertyId, cancellationToken);
        await reservationService.GetByIdAsync(id, propertyId, cancellationToken);
        var response = await reservationService.UpdateStatusAsync(id, request, GetCurrentUser(), cancellationToken);
        return Ok(await FilterStatusTransitionsAsync(propertyId, response, cancellationToken));
    }

    [HttpPost("{id:int}/payment-link")]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> GeneratePaymentLink(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        await EnsurePermissionAsync(propertyId, "bookings.edit", cancellationToken);
        await reservationService.GetByIdAsync(id, propertyId, cancellationToken);
        return Ok(await reservationService.GeneratePaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }

    [HttpPost("{id:int}/payment-link/send")]
    [ProducesResponseType<ReservationPaymentLinkResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationPaymentLinkResponse>> SendPaymentLink(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        await EnsurePermissionAsync(propertyId, "bookings.edit", cancellationToken);
        await reservationService.GetByIdAsync(id, propertyId, cancellationToken);
        return Ok(await reservationService.SendPaymentLinkAsync(id, GetCurrentUser(), cancellationToken));
    }

    private async Task EnsurePermissionAsync(
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (!await permissionService.CanAsync(user.UserId, propertyId, permissionKey, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property's reservations.");
        }
    }

    private async Task<ReservationResponse> FilterStatusTransitionsAsync(
        int propertyId,
        ReservationResponse response,
        CancellationToken cancellationToken)
    {
        var canEdit = await CanChangeStatusAsync(propertyId, cancellationToken);
        response.AllowedStatusTransitions = canEdit
            ? response.AllowedStatusTransitions
                .Where(status => status != ReservationStatus.Cancelled)
                .ToList()
            : [];
        return response;
    }

    private async Task EnsureStatusPermissionAsync(
        int propertyId,
        CancellationToken cancellationToken)
    {
        if (!await CanChangeStatusAsync(propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot change this property's reservation status.");
        }
    }

    private async Task<bool> CanChangeStatusAsync(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return await permissionService.CanAsync(
            user.UserId,
            propertyId,
            "bookings.edit",
            cancellationToken);
    }
}
