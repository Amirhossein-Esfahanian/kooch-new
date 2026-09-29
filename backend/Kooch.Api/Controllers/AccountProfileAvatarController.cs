using System.Security.Cryptography;
using Kooch.Api.Services.ProfileAvatar;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/account/profile/avatar")]
public sealed class AccountProfileAvatarController(ProfileAvatarService avatars) : AuthenticatedControllerBase
{
    [HttpPut]
    [RequestSizeLimit(ProfileAvatarService.MaximumUploadBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        await avatars.UploadAsync(GetCurrentUser().UserId, file, cancellationToken);
        return NoContent();
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var content = await avatars.ReadAsync(GetCurrentUser().UserId, cancellationToken);
        Response.Headers.CacheControl = "private, no-cache";
        if (content is null) return NotFound();

        var etag = $"\"{Convert.ToHexString(SHA256.HashData(content))}\"";
        Response.Headers.ETag = etag;
        if (Request.Headers.IfNoneMatch == etag) return StatusCode(StatusCodes.Status304NotModified);
        return File(content, "image/webp");
    }

    [HttpDelete]
    public async Task<IActionResult> Delete(CancellationToken cancellationToken)
    {
        await avatars.DeleteAsync(GetCurrentUser().UserId, cancellationToken);
        return NoContent();
    }
}
