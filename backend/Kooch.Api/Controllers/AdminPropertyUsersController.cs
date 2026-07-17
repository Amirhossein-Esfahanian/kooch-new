using Kooch.Api.Authentication;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/properties/{propertyId:int}/users")]
public class AdminPropertyUsersController(IPropertyUserService propertyUserService) : AuthenticatedControllerBase
{
    [HttpGet("permission-metadata")]
    [ProducesResponseType<PropertyPermissionMetadataResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyPermissionMetadataResponse>> GetPermissionMetadata(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyUserService.GetPermissionMetadataAsync(
            user.UserId,
            propertyId,
            cancellationToken));
    }

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyUserResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyUserResponse>>> Get(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyUserService.GetUsersAsync(user.UserId, user.Role, propertyId, cancellationToken));
    }

    [HttpPost]
    [ProducesResponseType<PropertyUserResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<PropertyUserResponse>> Create(
        int propertyId,
        PropertyUserRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var created = await propertyUserService.CreateUserAsync(user.UserId, user.Role, propertyId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { propertyId }, created);
    }

    [HttpPut("{userId:int}")]
    [ProducesResponseType<PropertyUserResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyUserResponse>> Update(
        int propertyId,
        int userId,
        PropertyUserRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyUserService.UpdateUserAsync(user.UserId, user.Role, propertyId, userId, request, cancellationToken));
    }

    [HttpDelete("{userId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(
        int propertyId,
        int userId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        await propertyUserService.DeleteUserAsync(user.UserId, user.Role, propertyId, userId, cancellationToken);
        return NoContent();
    }

    [HttpPut("{userId:int}/activate")]
    [ProducesResponseType<PropertyUserResponse>(StatusCodes.Status200OK)]
    public Task<ActionResult<PropertyUserResponse>> Activate(
        int propertyId,
        int userId,
        CancellationToken cancellationToken) =>
        SetStatus(propertyId, userId, PropertyUserStatus.Active, cancellationToken);

    [HttpPut("{userId:int}/suspend")]
    [ProducesResponseType<PropertyUserResponse>(StatusCodes.Status200OK)]
    public Task<ActionResult<PropertyUserResponse>> Suspend(
        int propertyId,
        int userId,
        CancellationToken cancellationToken) =>
        SetStatus(propertyId, userId, PropertyUserStatus.Suspended, cancellationToken);

    [HttpPut("{userId:int}/deactivate")]
    [ProducesResponseType<PropertyUserResponse>(StatusCodes.Status200OK)]
    public Task<ActionResult<PropertyUserResponse>> Deactivate(
        int propertyId,
        int userId,
        CancellationToken cancellationToken) =>
        SetStatus(propertyId, userId, PropertyUserStatus.Inactive, cancellationToken);

    private async Task<ActionResult<PropertyUserResponse>> SetStatus(
        int propertyId,
        int userId,
        PropertyUserStatus status,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyUserService.SetStatusAsync(
            user.UserId,
            user.Role,
            propertyId,
            userId,
            status,
            cancellationToken));
    }
}
