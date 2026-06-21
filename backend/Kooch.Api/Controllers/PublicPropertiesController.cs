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
        [FromQuery] string? q,
        [FromQuery] string? city,
        [FromQuery] DateOnly? checkIn,
        [FromQuery] DateOnly? checkOut,
        [FromQuery] int? rooms,
        [FromQuery] int? adults,
        [FromQuery] int? children,
        [FromQuery] string? childAges,
        CancellationToken cancellationToken) =>
        Ok(await propertyService.GetPublicPropertiesAsync(q, city, checkIn, checkOut, rooms, adults, children, childAges, cancellationToken));

    [HttpGet("suggestions")]
    [ProducesResponseType<IReadOnlyList<PublicPropertySuggestionResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PublicPropertySuggestionResponse>>> Suggestions(
        [FromQuery] string? q,
        [FromQuery] string? city,
        CancellationToken cancellationToken) =>
        Ok(await propertyService.GetPublicPropertySuggestionsAsync(q, city, cancellationToken));

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
