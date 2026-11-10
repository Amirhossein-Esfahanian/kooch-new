using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[SuperAdminAuthorize]
[PermissionAuthorize(PermissionKey.ManageReviews)]
[Route("api/admin/reviews")]
public sealed class AdminReviewsController(GuestReviewService reviews) : AuthenticatedControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<AdminReviewResponse>> List([FromQuery] AdminReviewQuery query, CancellationToken ct) =>
        reviews.ListForModerationAsync(GetCurrentUser().UserId, query, ct);

    [HttpGet("{id:int}")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<AdminReviewResponse> Get(int id, CancellationToken ct) =>
        reviews.GetForModerationAsync(GetCurrentUser().UserId, id, ct);

    [HttpPut("{id:int}/approve")]
    public Task<AdminReviewResponse> Approve(int id, ModerateReviewRequest request, CancellationToken ct) =>
        reviews.ModerateAsync(GetCurrentUser().UserId, id, request, true, ct);

    [HttpPut("{id:int}/reject")]
    public Task<AdminReviewResponse> Reject(int id, ModerateReviewRequest request, CancellationToken ct) =>
        reviews.ModerateAsync(GetCurrentUser().UserId, id, request, false, ct);

    [HttpPut("{id:int}/unpublish")]
    public Task<AdminReviewResponse> Unpublish(int id, ReviewPublicationRequest request, CancellationToken ct) =>
        reviews.SetPublicationAsync(GetCurrentUser().UserId, id, request, false, ct);

    [HttpPut("{id:int}/republish")]
    public Task<AdminReviewResponse> Republish(int id, ReviewPublicationRequest request, CancellationToken ct) =>
        reviews.SetPublicationAsync(GetCurrentUser().UserId, id, request, true, ct);
}
