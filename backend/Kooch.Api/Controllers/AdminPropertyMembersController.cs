using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/property-members")]
public sealed class AdminPropertyMembersController(
    IAdminPropertyMemberDirectoryService directoryService) : AuthenticatedControllerBase
{
    [HttpGet("properties")]
    [ProducesResponseType<PagedResult<AdminPropertyMemberPropertyOptionResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<AdminPropertyMemberPropertyOptionResponse>>> GetProperties(
        [FromQuery] AdminPropertyMemberPropertyOptionQuery query,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await directoryService.SearchPropertiesAsync(
            user.UserId,
            user.Role,
            query,
            cancellationToken));
    }

    [HttpGet]
    [ProducesResponseType<PagedResult<AdminPropertyMemberDirectoryResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<AdminPropertyMemberDirectoryResponse>>> Get(
        [FromQuery] AdminPropertyMemberDirectoryQuery query,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await directoryService.SearchAsync(
            user.UserId,
            user.Role,
            query,
            cancellationToken));
    }
}
