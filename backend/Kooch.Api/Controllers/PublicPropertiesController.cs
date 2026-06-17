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
    [ProducesResponseType<IReadOnlyList<PublicPropertyResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PublicPropertyResponse>>> Get(
        [FromQuery] string? city,
        [FromQuery] DateOnly? checkIn,
        [FromQuery] DateOnly? checkOut,
        [FromQuery] int? adults,
        [FromQuery] int? children,
        CancellationToken cancellationToken) =>
        Ok(await propertyService.GetPublicPropertiesAsync(city, checkIn, checkOut, adults, children, cancellationToken));

    [HttpGet("{slug}")]
    [ProducesResponseType<PublicPropertyResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PublicPropertyResponse>> GetBySlug(
        string slug,
        CancellationToken cancellationToken)
    {
        var property = await propertyService.GetPublicPropertyBySlugAsync(slug, cancellationToken);
        return property is null ? NotFound() : Ok(property);
    }
}
