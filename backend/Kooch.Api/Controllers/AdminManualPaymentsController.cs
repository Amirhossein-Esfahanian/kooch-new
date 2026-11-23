using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/manual-payments")]
public sealed class AdminManualPaymentsController(IAdminManualPaymentService manualPaymentService)
    : AuthenticatedControllerBase
{
    [HttpGet("pending")]
    public async Task<ActionResult<Kooch.Api.Dtos.Reservations.PagedResult<ManualPaymentReviewQueueItem>>> GetPendingReview(
        [FromQuery] ManualPaymentReviewQueueQuery query, CancellationToken cancellationToken) =>
        Ok(await manualPaymentService.GetPendingReviewAsync(query, GetCurrentUser().UserId, cancellationToken));

    [HttpGet("orders/{bookingSessionId:int}")]
    public async Task<ActionResult<ManualOrderBalanceResponse>> GetOrderBalance(
        int bookingSessionId, CancellationToken cancellationToken) =>
        Ok(await manualPaymentService.GetOrderBalanceAsync(bookingSessionId, GetCurrentUser().UserId, cancellationToken));

    [HttpPost("orders/{bookingSessionId:int}/settle")]
    public async Task<ActionResult<ManualOrderSettlementResponse>> SettleOrder(
        int bookingSessionId, ManualOrderSettlementRequest request, CancellationToken cancellationToken) =>
        Ok(await manualPaymentService.SettleOrderAsync(bookingSessionId, request, GetCurrentUser().UserId, cancellationToken));

    [HttpGet("reservation/{reservationId:int}")]
    [ProducesResponseType<IReadOnlyList<AdminManualPaymentDetailsResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AdminManualPaymentDetailsResponse>>> GetByReservation(
        int reservationId,
        CancellationToken cancellationToken)
    {
        return Ok(await manualPaymentService.GetByReservationAsync(reservationId, GetCurrentUser().UserId, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<AdminManualPaymentResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AdminManualPaymentResponse>> Create(
        AdminManualPaymentCreateRequest request,
        CancellationToken cancellationToken)
    {
        var result = await manualPaymentService.CreateAsync(
            request,
            GetCurrentUser().UserId,
            cancellationToken);
        return Created($"/api/admin/manual-payments/{result.PaymentId}", result);
    }

    [HttpPost("{paymentId:int}/approve")]
    [ProducesResponseType<AdminManualPaymentResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminManualPaymentResponse>> Approve(
        int paymentId,
        CancellationToken cancellationToken)
    {
        return Ok(await manualPaymentService.ApproveAsync(
            paymentId,
            GetCurrentUser().UserId,
            cancellationToken));
    }

    [HttpPost("{paymentId:int}/reject")]
    [ProducesResponseType<AdminManualPaymentResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminManualPaymentResponse>> Reject(
        int paymentId,
        AdminManualPaymentRejectRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await manualPaymentService.RejectAsync(
            paymentId,
            request,
            GetCurrentUser().UserId,
            cancellationToken));
    }
}
