using Kooch.Api.Authentication;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/property-direct-booking-contexts")]
[EnableRateLimiting(PropertyDirectBookingContextRateLimitPolicy.Name)]
public sealed class AccountPropertyDirectBookingContextsController(IPropertyDirectBookingContextService service)
    : AuthenticatedControllerBase
{
    [HttpPost]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType<PropertyDirectBookingContextResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<PropertyDirectBookingContextResponse>> Create(
        [FromBody] PropertyDirectBookingContextRequest request, CancellationToken cancellationToken)
    {
        var currentUser = GetCurrentUser();
        try
        {
            return Ok(await service.IssueAsync(currentUser.UserId, request, cancellationToken));
        }
        catch (PropertyDirectBookingContextUnavailableException exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = exception.Message });
        }
    }
}
