using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController, SuperAdminAuthorize, PermissionAuthorize(PermissionKey.ManageReviews)]
[Route("api/admin/review-replies")]
public sealed class AdminReviewRepliesController(GuestReviewService reviews) : AuthenticatedControllerBase
{
    [HttpGet, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<AdminOwnerReplyResponse>> List([FromQuery] AdminReviewQuery query, CancellationToken ct) =>
        reviews.ListRepliesForModerationAsync(GetCurrentUser().UserId, query, ct);
    [HttpPut("{id:int}/approve")]
    public Task<OwnerReplyResponse> Approve(int id, ModerateReviewRequest request, CancellationToken ct) =>
        reviews.ModerateReplyAsync(GetCurrentUser().UserId, id, request, true, ct);
    [HttpPut("{id:int}/reject")]
    public Task<OwnerReplyResponse> Reject(int id, ModerateReviewRequest request, CancellationToken ct) =>
        reviews.ModerateReplyAsync(GetCurrentUser().UserId, id, request, false, ct);
}
