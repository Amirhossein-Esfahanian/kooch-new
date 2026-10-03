using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Cashback;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
public sealed class AdminCashbackSettingsController(
    ICashbackSettingsService cashbackSettingsService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet("api/admin/cashback/settings")]
    public async Task<ActionResult<CashbackPolicyResponse>> GetGlobal([FromQuery] string currency, CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await cashbackSettingsService.GetGlobalAsync(currency, cancellationToken));
    }

    [HttpPut("api/admin/cashback/settings")]
    public async Task<ActionResult<CashbackPolicyResponse>> UpdateGlobal(UpdateCashbackPolicyRequest request, CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await cashbackSettingsService.UpdateGlobalAsync(request, cancellationToken));
    }

    [HttpGet("api/admin/properties/{propertyId:int}/cashback")]
    public async Task<ActionResult<PropertyCashbackResponse>> GetProperty(int propertyId, [FromQuery] string currency, CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await cashbackSettingsService.GetPropertyAsync(propertyId, currency, cancellationToken));
    }

    [HttpPut("api/admin/properties/{propertyId:int}/cashback")]
    public async Task<ActionResult<PropertyCashbackResponse>> UpdateProperty(int propertyId, UpdatePropertyCashbackRequest request, CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await cashbackSettingsService.UpdatePropertyAsync(propertyId, request, cancellationToken));
    }

    private async Task EnsureCanManageSettingsAsync(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (user.Role == UserRole.SuperAdmin) return;
        if (!await permissionService.HasPermissionAsync(user.UserId, PermissionKey.ManageSettings, cancellationToken: cancellationToken))
            throw new UnauthorizedAccessException("You do not have permission to manage site settings.");
    }
}
