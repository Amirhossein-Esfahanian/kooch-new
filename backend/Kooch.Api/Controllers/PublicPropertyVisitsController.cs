using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/properties/{slug}/visits")]
public sealed class PublicPropertyVisitsController(PropertyVisitService visitService) : ControllerBase
{
    [HttpPost]
    [EnableRateLimiting(PropertyVisitRateLimitPolicy.Name)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Record(
        string slug, RecordPropertyVisitRequest request, CancellationToken cancellationToken)
    {
        await visitService.RecordAsync(slug, request.SessionId, User,
            Request.Headers.UserAgent.ToString(), cancellationToken);
        return NoContent();
    }
}
