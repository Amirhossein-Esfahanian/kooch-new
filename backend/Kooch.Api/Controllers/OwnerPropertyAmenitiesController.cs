using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/amenities")]
public class OwnerPropertyAmenitiesController(IPropertyAmenityService amenityService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PropertyAmenityResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await amenityService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<IReadOnlyList<PropertyAmenityResponse>>> Add(
        int propertyId, SetPropertyAmenitiesRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await amenityService.AddAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpPut]
    public async Task<ActionResult<IReadOnlyList<PropertyAmenityResponse>>> Replace(
        int propertyId, SetPropertyAmenitiesRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await amenityService.ReplaceAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }
}
