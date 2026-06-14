using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/descriptions")]
public class OwnerPropertyDescriptionsController(IPropertyDescriptionService descriptionService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PropertyDescriptionSectionResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await descriptionService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<PropertyDescriptionSectionResponse>> Create(
        int propertyId, PropertyDescriptionSectionRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var description = await descriptionService.CreateAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, description);
    }

    [HttpPut("/api/owner/property-descriptions/{descriptionId:int}")]
    public async Task<ActionResult<PropertyDescriptionSectionResponse>> Update(
        int descriptionId, PropertyDescriptionSectionRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await descriptionService.UpdateAsync(
            user.UserId, user.Role, descriptionId, request, cancellationToken));
    }
}
