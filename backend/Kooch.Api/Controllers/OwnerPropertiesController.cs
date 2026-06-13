using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties")]
public class OwnerPropertiesController(IPropertyService propertyService) : AuthenticatedControllerBase
{
    [HttpPost]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<PropertyResponse>> Create(
        CreatePropertyRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var property = await propertyService.CreatePropertyAsync(
            user.UserId, user.Role, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = property.Id }, property);
    }

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyResponse>>> GetMine(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetMyPropertiesAsync(user.UserId, user.Role, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetPropertyByIdAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Update(
        int id,
        UpdatePropertyRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.UpdatePropertyAsync(
            user.UserId, user.Role, id, request, cancellationToken));
    }
}
