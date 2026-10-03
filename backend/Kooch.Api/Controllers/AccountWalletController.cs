using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Dtos.Reservations;
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

    [HttpPost("withdrawals")]
    [ProducesResponseType<WalletWithdrawalResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<WalletWithdrawalResponse>> CreateWithdrawal(
        CreateWalletWithdrawalRequest request, CancellationToken cancellationToken)
    {
        var created = await walletService.CreateWithdrawalAsync(
            GetCurrentUser().UserId, request.Currency, request.Amount, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpGet("withdrawals")]
    [ProducesResponseType<PagedResult<WalletWithdrawalResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<WalletWithdrawalResponse>>> ListWithdrawals(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default) =>
        Ok(await walletService.ListWithdrawalsAsync(GetCurrentUser().UserId, page, pageSize, cancellationToken));
}
