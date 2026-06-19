using Kooch.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/site-settings")]
public class SiteSettingsController(KoochDbContext dbContext) : ControllerBase
{
    [HttpGet("public")]
    [ProducesResponseType<Dictionary<string, string>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<Dictionary<string, string>>> GetPublic(CancellationToken cancellationToken)
    {
        var settings = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive)
            .OrderBy(setting => setting.Group)
            .ThenBy(setting => setting.SortOrder)
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        return Ok(settings);
    }
}
