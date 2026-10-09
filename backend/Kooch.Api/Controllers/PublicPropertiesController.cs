using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/properties")]
public class PublicPropertiesController(
    IPropertyService propertyService,
    IPublicBookingOptionsService bookingOptionsService,
    PublicRoomTypeCalendarService roomTypeCalendarService) : ControllerBase
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
        [FromQuery] string? settingSlugs,
        CancellationToken cancellationToken) =>
        Ok(await propertyService.GetPublicPropertiesAsync(
            q,
            city,
            checkIn,
            checkOut,
            rooms,
            adults,
            children,
            childAges,
            settingSlugs,
            cancellationToken));

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

    [HttpGet("{slug}/room-types/{roomTypeId:int}/calendar")]
    [ProducesResponseType<PublicRoomTypeCalendarResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PublicRoomTypeCalendarResponse>> GetRoomTypeCalendar(
        string slug,
        int roomTypeId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken cancellationToken)
    {
        if (from is null || to is null || from > to || to == DateOnly.MaxValue ||
            to.Value.DayNumber - from.Value.DayNumber > 62)
        {
            return BadRequest(new { message = "Use from/to dates with a maximum inclusive range of 63 days." });
        }

        var calendar = await roomTypeCalendarService.GetAsync(
            slug, roomTypeId, from.Value, to.Value, cancellationToken);
        return calendar is null ? NotFound() : Ok(calendar);
    }

    [HttpGet("{slug}/booking-options")]
    [ProducesResponseType<PublicBookingOptionsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PublicBookingOptionsResponse>> GetBookingOptions(
        string slug,
        [FromQuery] DateOnly checkIn,
        [FromQuery] DateOnly checkOut,
        [FromQuery] int adults,
        [FromQuery] int children,
        [FromQuery] string? childAges,
        CancellationToken cancellationToken)
    {
        var ages = ParseChildAges(childAges, children);
        return Ok(await bookingOptionsService.GetAsync(
            slug,
            checkIn,
            checkOut,
            adults,
            children,
            ages,
            cancellationToken));
    }

    private static IReadOnlyList<int> ParseChildAges(string? value, int children)
    {
        if (children is 0 && string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        var ages = (value ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(item => int.TryParse(item, out var age) ? age : -1)
            .ToArray();
        if (ages.Length != children)
        {
            throw new ArgumentException("A child age must be supplied for every child.");
        }

        return ages;
    }
}
