using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/properties")]
public class PublicPropertiesController(IPropertyService propertyService) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyResponse>>> Get(CancellationToken cancellationToken) =>
        Ok(await propertyService.GetPublicPropertiesAsync(cancellationToken));

    [HttpGet("{slug}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PropertyResponse>> GetBySlug(
        string slug,
        CancellationToken cancellationToken)
    {
        var property = await propertyService.GetPublicPropertyBySlugAsync(slug, cancellationToken);
        return property is null ? NotFound() : Ok(property);
    }
}
