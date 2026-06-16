using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/views")]
public class OwnerPropertyViewsController(IPropertyViewService propertyViewService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PropertyViewResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyViewService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPut]
    public async Task<ActionResult<IReadOnlyList<PropertyViewResponse>>> Replace(
        int propertyId, SetPropertyViewsRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyViewService.ReplaceAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }
}
