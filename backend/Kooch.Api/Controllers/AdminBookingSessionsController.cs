using Kooch.Api.Authentication;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/booking-sessions")]
public sealed class AdminBookingSessionsController(
    IBookingSessionQueryService queryService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet("{id:int}")]
    [ProducesResponseType<BookingSessionDetailsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BookingSessionDetailsResponse>> GetById(
        int id,
        CancellationToken cancellationToken)
    {
        var response = await queryService.GetByIdAsync(id, cancellationToken);
        await EnsureCanViewAsync(response.Property.PropertyId, cancellationToken);
        return Ok(response);
    }

    [HttpGet("by-code/{sessionCode}")]
    [ProducesResponseType<BookingSessionDetailsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BookingSessionDetailsResponse>> GetBySessionCode(
        string sessionCode,
        CancellationToken cancellationToken)
    {
        var response = await queryService.GetBySessionCodeAsync(sessionCode, cancellationToken);
        await EnsureCanViewAsync(response.Property.PropertyId, cancellationToken);
        return Ok(response);
    }

    private async Task EnsureCanViewAsync(int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var hasGlobalPermission = await permissionService.HasPermissionAsync(
            user.UserId,
            PermissionKey.ManageReservations,
            cancellationToken: cancellationToken);
        var hasPropertyPermission = hasGlobalPermission ||
                                    await permissionService.CanAsync(
                                        user.UserId,
                                        propertyId,
                                        "bookings.view",
                                        cancellationToken);
        if (!hasPropertyPermission)
        {
            throw new UnauthorizedAccessException(
                "You cannot access this property's booking sessions.");
        }
    }
}
