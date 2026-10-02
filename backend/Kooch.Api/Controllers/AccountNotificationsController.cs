using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/notifications")]
public sealed class AccountNotificationsController(AccountNotificationInboxService inbox) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<PagedResult<NotificationInboxItemResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<NotificationInboxItemResponse>>> List(
        [FromQuery] NotificationInboxQuery query, CancellationToken cancellationToken) =>
        Ok(await inbox.ListAsync(GetCurrentUser().UserId, query, cancellationToken));

    [HttpGet("unread-count")]
    [ProducesResponseType<NotificationUnreadCountResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<NotificationUnreadCountResponse>> UnreadCount(CancellationToken cancellationToken) =>
        Ok(new NotificationUnreadCountResponse
        {
            UnreadCount = await inbox.UnreadCountAsync(GetCurrentUser().UserId, cancellationToken)
        });

    [HttpPut("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id, CancellationToken cancellationToken)
    {
        await inbox.MarkReadAsync(GetCurrentUser().UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPut("read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken cancellationToken)
    {
        await inbox.MarkAllReadAsync(GetCurrentUser().UserId, cancellationToken);
        return NoContent();
    }
}
