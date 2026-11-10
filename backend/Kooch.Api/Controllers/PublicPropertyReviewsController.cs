using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController, AllowAnonymous]
[Route("api/properties/{slug}/reviews")]
public sealed class PublicPropertyReviewsController(GuestReviewService reviews) : ControllerBase
{
    [HttpGet, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PublicPropertyReviewsResponse> Get(string slug, int page = 1, int pageSize = 10, CancellationToken ct = default) =>
        reviews.GetPublicReviewsAsync(slug, page, pageSize, ct);
}
