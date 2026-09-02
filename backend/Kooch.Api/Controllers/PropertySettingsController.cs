using Kooch.Api.Authentication;
using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/property-settings")]
public sealed class PropertySettingsController(
    IPropertySettingService propertySettingService,
    IAuthorizationService authorizationService) : AuthenticatedControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType<IReadOnlyList<PropertySettingResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertySettingResponse>>> Get(
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        if (includeInactive)
        {
            var authorization = await authorizationService.AuthorizeAsync(
                User,
                policyName: AuthorizationPolicies.AdminUsers);
            if (!authorization.Succeeded)
            {
                return User.Identity?.IsAuthenticated == true ? Forbid() : Challenge();
            }
        }

        return Ok(await propertySettingService.GetCatalogAsync(includeInactive, cancellationToken));
    }

    [HttpPost]
    [AdminAuthorize]
    [ProducesResponseType<PropertySettingResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<PropertySettingResponse>> Create(
        CreatePropertySettingRequest request,
        CancellationToken cancellationToken)
    {
        var created = await propertySettingService.CreateAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType<PropertySettingResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertySettingResponse>> Update(
        int id,
        UpdatePropertySettingRequest request,
        CancellationToken cancellationToken) =>
        Ok(await propertySettingService.UpdateAsync(id, request, cancellationToken));

    [HttpDelete("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await propertySettingService.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
