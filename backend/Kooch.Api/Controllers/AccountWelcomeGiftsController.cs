using System.ComponentModel.DataAnnotations;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.WelcomeGifts;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/welcome-gifts")]
public sealed class AccountWelcomeGiftsController(WelcomeGiftHistoryService history) : AuthenticatedControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PagedResult<GuestWelcomeGiftResponse>> List(
        [FromQuery, Range(1, 100000)] int page = 1,
        [FromQuery, Range(1, 100)] int pageSize = 20,
        CancellationToken cancellationToken = default) =>
        history.ListAsync(GetCurrentUser().UserId, page, pageSize, cancellationToken);
}
