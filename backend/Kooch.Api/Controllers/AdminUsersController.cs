using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/admin/users")]
public class AdminUsersController(IAdminUserService userService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<AdminUserResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AdminUserResponse>>> Get(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await userService.GetUsersAsync(user.UserId, user.Role, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<AdminUserResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminUserResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await userService.GetUserAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<AdminUserResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AdminUserResponse>> Create(AdminUserRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var created = await userService.CreateUserAsync(user.UserId, user.Role, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<AdminUserResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminUserResponse>> Update(int id, AdminUserRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await userService.UpdateUserAsync(user.UserId, user.Role, id, request, cancellationToken));
    }

    [HttpPut("{id:int}/activate")]
    [ProducesResponseType<AdminUserResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminUserResponse>> Activate(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await userService.SetActiveAsync(user.UserId, user.Role, id, true, cancellationToken));
    }

    [HttpPut("{id:int}/deactivate")]
    [ProducesResponseType<AdminUserResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminUserResponse>> Deactivate(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await userService.SetActiveAsync(user.UserId, user.Role, id, false, cancellationToken));
    }
}
