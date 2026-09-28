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
        ReservationRefundRequest request, CancellationToken cancellationToken) =>
        Ok(await service.RecordAsync(reservationId, request, GetCurrentUser().UserId, cancellationToken));
}
