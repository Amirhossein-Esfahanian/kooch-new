using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner/properties/{propertyId:int}/common-areas")]
public class OwnerPropertyCommonAreasController(IPropertyCommonAreaService commonAreaService)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PropertyCommonAreaResponse>>> Get(
        int propertyId, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await commonAreaService.GetAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPut]
    public async Task<ActionResult<IReadOnlyList<PropertyCommonAreaResponse>>> Replace(
        int propertyId, ReplacePropertyCommonAreasRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await commonAreaService.ReplaceAsync(user.UserId, user.Role, propertyId, request, cancellationToken));
    }
}
