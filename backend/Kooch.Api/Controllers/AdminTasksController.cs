using Kooch.Api.Authentication;
using Kooch.Api.Dtos.AdminTasks;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManageReservations)]
[Route("api/admin/tasks")]
public sealed class AdminTasksController(AdminTaskService tasks) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AdminTaskResponse>>> List(CancellationToken cancellationToken) =>
        Ok(await tasks.ListAsync(GetCurrentUser().UserId, cancellationToken));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<AdminTaskResponse>> Get(int id, CancellationToken cancellationToken) =>
        Ok(await tasks.GetAsync(GetCurrentUser().UserId, id, cancellationToken));

    [HttpPost]
    public async Task<ActionResult<AdminTaskResponse>> Create(
        CreateAdminTaskRequest request, CancellationToken cancellationToken)
    {
        var created = await tasks.CreateAsync(GetCurrentUser().UserId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}/assignee")]
    public async Task<ActionResult<AdminTaskResponse>> Reassign(
        int id, ReassignAdminTaskRequest request, CancellationToken cancellationToken) =>
        Ok(await tasks.ReassignAsync(GetCurrentUser().UserId, id, request, cancellationToken));

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<AdminTaskResponse>> UpdateStatus(
        int id, UpdateAdminTaskStatusRequest request, CancellationToken cancellationToken) =>
        Ok(await tasks.UpdateStatusAsync(GetCurrentUser().UserId, id, request, cancellationToken));
}
