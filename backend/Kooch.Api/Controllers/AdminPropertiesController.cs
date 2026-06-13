using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/properties")]
public class AdminPropertiesController(IPropertyService propertyService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyResponse>>> Get(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetAllForAdminAsync(user.UserId, user.Role, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetPropertyByIdAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Approve(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.ApprovePropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/reject")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Reject(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.RejectPropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/suspend")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Suspend(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.SuspendPropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }
}
