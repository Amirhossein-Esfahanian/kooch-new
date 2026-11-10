using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController, OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/reviews")]
public sealed class OwnerReviewsController(GuestReviewService reviews) : AuthenticatedControllerBase
{
    [HttpGet, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<OwnerReviewResponse>> List(int propertyId, string filter = "All", int page = 1, int pageSize = 20, CancellationToken ct = default) =>
        reviews.ListOwnerReviewsAsync(GetCurrentUser().UserId, propertyId, filter, page, pageSize, ct);

    [HttpPut("{reviewId:int}/reply")]
    public Task<OwnerReplyResponse> Save(int propertyId, int reviewId, OwnerReplyRequest request, CancellationToken ct) =>
        reviews.SaveOwnerReplyAsync(GetCurrentUser().UserId, propertyId, reviewId, request, ct);
}
