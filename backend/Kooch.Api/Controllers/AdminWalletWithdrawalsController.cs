using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/wallet/withdrawals")]
public sealed class AdminWalletWithdrawalsController(WalletService walletService) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<AdminWalletWithdrawalResponse>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] WalletWithdrawalStatus? status = null,
        CancellationToken cancellationToken = default) =>
        Ok(await walletService.ListAdminWithdrawalsAsync(page, pageSize, status, cancellationToken));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<AdminWalletWithdrawalResponse>> Get(int id,
        CancellationToken cancellationToken) =>
        Ok(await walletService.GetAdminWithdrawalAsync(id, cancellationToken));

    [HttpPut("{id:int}/approve")]
    public async Task<ActionResult<AdminWalletWithdrawalResponse>> Approve(int id,
        CancellationToken cancellationToken) =>
        Ok(await walletService.ApproveWithdrawalAsync(id, GetCurrentUser().UserId, cancellationToken));

    [HttpPut("{id:int}/reject")]
    public async Task<ActionResult<AdminWalletWithdrawalResponse>> Reject(int id,
        CancellationToken cancellationToken) =>
        Ok(await walletService.RejectWithdrawalAsync(id, GetCurrentUser().UserId, cancellationToken));
}
