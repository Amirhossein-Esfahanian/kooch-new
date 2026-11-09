using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/reviews")]
public sealed class AccountReviewsController(GuestReviewService reviews) : AuthenticatedControllerBase
{
    [HttpPut("reservations/{reservationId:int}/invitation-suppression")]
    public Task<ReviewInvitationPreferenceResponse> SuppressInvitation(int reservationId, CancellationToken cancellationToken) =>
        reviews.SuppressInvitationAsync(GetCurrentUser().UserId, reservationId, cancellationToken);

    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<GuestReviewListItemResponse>> List([FromQuery] int page = 1,
        [FromQuery] int pageSize = 20, CancellationToken cancellationToken = default) =>
        reviews.ListAsync(GetCurrentUser().UserId, page, pageSize, cancellationToken);

    [HttpGet("eligible-reservations")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<EligibleReviewReservationResponse>> Eligible([FromQuery] int page = 1,
        [FromQuery] int pageSize = 20, CancellationToken cancellationToken = default) =>
        reviews.EligibleAsync(GetCurrentUser().UserId, page, pageSize, cancellationToken);

    [HttpGet("reservations/{reservationId:int}")]
    public Task<GuestReviewResponse> Get(int reservationId, CancellationToken cancellationToken) =>
        reviews.GetAsync(GetCurrentUser().UserId, reservationId, cancellationToken);

    [HttpPost("reservations/{reservationId:int}")]
    public Task<GuestReviewResponse> Create(int reservationId, GuestReviewRequest request, CancellationToken cancellationToken) =>
        reviews.SaveAsync(GetCurrentUser().UserId, reservationId, request, false, cancellationToken);

    [HttpPut("reservations/{reservationId:int}")]
    public Task<GuestReviewResponse> Edit(int reservationId, GuestReviewRequest request, CancellationToken cancellationToken) =>
        reviews.SaveAsync(GetCurrentUser().UserId, reservationId, request, true, cancellationToken);
}
