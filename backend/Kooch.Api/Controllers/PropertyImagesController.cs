using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
public class PropertyImagesController(IPropertyImageService imageService) : AuthenticatedControllerBase
{
    [HttpGet("api/owner/properties/{propertyId:int}/images")]
    public async Task<ActionResult<IReadOnlyList<PropertyImageResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await imageService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost("api/owner/properties/{propertyId:int}/images")]
    public async Task<ActionResult<PropertyImageResponse>> Create(
        int propertyId, PropertyImageRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var image = await imageService.CreateAsync(user.UserId, user.Role, propertyId, request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, image);
    }

    [HttpPut("api/owner/property-images/{imageId:int}")]
    public async Task<ActionResult<PropertyImageResponse>> Update(
        int imageId, PropertyImageRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await imageService.UpdateAsync(user.UserId, user.Role, imageId, request, cancellationToken));
    }

    [HttpDelete("api/owner/property-images/{imageId:int}")]
    public async Task<IActionResult> Delete(int imageId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await imageService.DeleteAsync(user.UserId, user.Role, imageId, cancellationToken);
        return NoContent();
    }
}
