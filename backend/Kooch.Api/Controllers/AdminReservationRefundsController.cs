using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/reservations/{reservationId:int}/refund")]
public sealed class AdminReservationRefundsController(ReservationRefundService service) : AuthenticatedControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ReservationRefundResponse>> Record(int reservationId,
        ReservationRefundRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await service.RecordAsync(reservationId, request, GetCurrentUser().UserId, cancellationToken));
        }
        catch (InvalidOperationException error) when (error.Message.StartsWith("NoGuestRefundRequired:", StringComparison.Ordinal))
        {
            return Conflict(new { code = "NoGuestRefundRequired", message = error.Message });
        }
        catch (InvalidOperationException error) when (error.Message.StartsWith("RefundAlreadyRecorded:", StringComparison.Ordinal))
        {
            return Conflict(new { code = "RefundAlreadyRecorded", message = error.Message });
        }
        catch (InvalidOperationException error) when (error.Message.StartsWith("RefundIdempotencyConflict:", StringComparison.Ordinal))
        {
            return Conflict(new { code = "RefundIdempotencyConflict", message = error.Message });
        }
    }
}
