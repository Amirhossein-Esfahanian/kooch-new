using Kooch.Api.Authentication;
using Kooch.Api.Dtos.SiteSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/site-settings/pricing-bounds")]
public sealed class AdminPricingBoundsController(
    IPricingBoundsService pricingBoundsService,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PricingBoundsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PricingBoundsResponse>> Get(CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await pricingBoundsService.GetAsync(cancellationToken));
    }

    [HttpPut]
    [ProducesResponseType<PricingBoundsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PricingBoundsResponse>> Update(
        UpdatePricingBoundsRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        return Ok(await pricingBoundsService.UpdateAsync(request, cancellationToken));
    }

    private async Task EnsureCanManageSettingsAsync(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (user.Role == UserRole.SuperAdmin)
        {
            return;
        }

        if (!await permissionService.HasPermissionAsync(
                user.UserId,
                PermissionKey.ManageSettings,
                cancellationToken: cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to manage site settings.");
        }
    }
}
