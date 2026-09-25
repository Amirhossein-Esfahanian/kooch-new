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
