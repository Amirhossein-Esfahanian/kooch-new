using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/site-settings")]
public class SiteSettingsController(KoochDbContext dbContext) : ControllerBase
{
    private static readonly string[] PublicKeys =
    [
        "site.name",
        "site.logoUrl",
        "site.footerText",
        "home.heroTitle",
        "home.heroSubtitle",
        "home.heroBackgroundUrl",
        "home.searchButtonText",
        "home.popularSectionTitle",
        "home.popularSectionSubtitle",
        "site.defaultSeoTitle",
        "site.defaultSeoDescription",
        "pricing.currencyLabel"
    ];

    private static readonly string[] ManagementKeys =
    [
        "image.maxFileSizeMb",
        "image.minWidth",
        "image.minHeight",
        "image.maxImagesPerProperty",
        "pricing.minPrice",
        "pricing.maxPrice"
    ];

    [HttpGet("public")]
    [ProducesResponseType<Dictionary<string, string>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<Dictionary<string, string>>> GetPublic(CancellationToken cancellationToken)
    {
        var settings = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && PublicKeys.Contains(setting.Key))
            .OrderBy(setting => setting.Group)
            .ThenBy(setting => setting.SortOrder)
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        return Ok(settings);
    }

    [HttpGet("management")]
    [OwnerAuthorize]
    [ProducesResponseType<Dictionary<string, string>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<Dictionary<string, string>>> GetManagement(
        CancellationToken cancellationToken)
    {
        var settings = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && ManagementKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        return Ok(settings);
    }
}
