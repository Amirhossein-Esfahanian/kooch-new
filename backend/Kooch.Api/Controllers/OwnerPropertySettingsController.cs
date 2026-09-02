using Kooch.Api.Authentication;
using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/settings")]
public sealed class OwnerPropertySettingsController(IPropertySettingService propertySettingService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertySettingAssignmentResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertySettingAssignmentResponse>>> Get(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertySettingService.GetPropertySettingsAsync(
            user.UserId,
            user.Role,
            propertyId,
            cancellationToken));
    }

    [HttpPut]
    [ProducesResponseType<IReadOnlyList<PropertySettingAssignmentResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertySettingAssignmentResponse>>> Replace(
        int propertyId,
        SetPropertySettingsRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertySettingService.ReplacePropertySettingsAsync(
            user.UserId,
            user.Role,
            propertyId,
            request,
            cancellationToken));
    }
}
