using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.SiteSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/site-settings")]
public class AdminSiteSettingsController(
    KoochDbContext dbContext,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<SiteSettingResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<SiteSettingResponse>>> Get(CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);

        var settings = await dbContext.SiteSettings.AsNoTracking()
            .OrderBy(setting => setting.Group)
            .ThenBy(setting => setting.SortOrder)
            .ToListAsync(cancellationToken);

        return Ok(settings.Select(ToResponse).ToList());
    }

    [HttpPut("{key}")]
    [ProducesResponseType<SiteSettingResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<SiteSettingResponse>> Update(
        string key,
        UpdateSiteSettingRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);

        var setting = await dbContext.SiteSettings
            .SingleOrDefaultAsync(setting => setting.Key == key, cancellationToken)
            ?? throw new KeyNotFoundException("Site setting was not found.");

        setting.Value = request.Value ?? string.Empty;
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ToResponse(setting));
    }

    private async Task EnsureCanManageSettingsAsync(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        if (user.Role == UserRole.SuperAdmin)
        {
            return;
        }

        if (!await permissionService.HasPermissionAsync(user.UserId, PermissionKey.ManageSettings, cancellationToken: cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to manage site settings.");
        }
    }

    private static SiteSettingResponse ToResponse(SiteSetting setting) =>
        new(
            setting.Id,
            setting.Key,
            setting.Value,
            setting.Type,
            setting.Group,
            setting.Label,
            setting.Description,
            setting.SortOrder,
            setting.IsActive,
            setting.CreatedAtUtc,
            setting.UpdatedAtUtc);
}
