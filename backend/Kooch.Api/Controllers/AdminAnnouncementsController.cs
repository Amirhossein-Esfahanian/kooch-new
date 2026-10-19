using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Announcements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManageNotifications)]
[Route("api/admin/announcements")]
public sealed class AdminAnnouncementsController(AdminAnnouncementService announcements)
    : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AdminAnnouncementResponse>>> List(
        CancellationToken cancellationToken) =>
        Ok(await announcements.ListAsync(GetCurrentUser().UserId, cancellationToken));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<AdminAnnouncementResponse>> Get(
        int id, CancellationToken cancellationToken) =>
        Ok(await announcements.GetAsync(GetCurrentUser().UserId, id, cancellationToken));

    [HttpPost]
    public async Task<ActionResult<AdminAnnouncementResponse>> Send(
        SendAdminAnnouncementRequest request, CancellationToken cancellationToken)
    {
        var sent = await announcements.SendAsync(GetCurrentUser().UserId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = sent.Id }, sent);
    }
}
