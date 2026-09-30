using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Services.Wallet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/wallet")]
public sealed class AccountWalletController(WalletService walletService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<WalletBalanceResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<WalletBalanceResponse>> Get(
        [FromQuery] string currency = "IRR", CancellationToken cancellationToken = default)
    {
        return Ok(await walletService.GetBalanceAsync(GetCurrentUser().UserId, currency, cancellationToken));
    }
}
