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
    IPermissionService permissionService,
    IWebHostEnvironment environment) : AuthenticatedControllerBase
{
    private const long MaxFileSizeBytes = 5 * 1024 * 1024;
    private static readonly HashSet<string> UploadableImageKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "site.logoUrl",
        "home.heroBackgroundUrl"
    };
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".svg"
    };

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

    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    [ProducesResponseType<SiteSettingResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<SiteSettingResponse>> Upload(
        [FromForm] IFormFile file,
        [FromForm] string key,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);

        if (!UploadableImageKeys.Contains(key))
        {
            throw new ArgumentException("This setting does not support image uploads.");
        }

        var setting = await dbContext.SiteSettings
            .SingleOrDefaultAsync(setting => setting.Key == key, cancellationToken)
            ?? throw new KeyNotFoundException("Site setting was not found.");

        await ValidateUploadAsync(file, cancellationToken);

        var uploadRoot = Path.Combine(
            environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"),
            "uploads",
            "site");
        Directory.CreateDirectory(uploadRoot);

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var fileName = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}{extension}";
        var absolutePath = Path.Combine(uploadRoot, fileName);

        await using (var stream = System.IO.File.Create(absolutePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        setting.Value = $"/uploads/site/{fileName}";
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

    private static async Task ValidateUploadAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ArgumentException("Uploaded file is empty.");
        }

        if (file.Length > MaxFileSizeBytes)
        {
            throw new ArgumentException("Image must be 5MB or smaller.");
        }

        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            throw new ArgumentException("Only jpg, jpeg, png, webp and svg files are allowed.");
        }

        var buffer = new byte[Math.Min(256, file.Length)];
        await using var stream = file.OpenReadStream();
        var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
        if (!HasKnownImageSignature(buffer.AsSpan(0, read), extension))
        {
            throw new ArgumentException("The uploaded file is not a supported image.");
        }
    }

    private static bool HasKnownImageSignature(ReadOnlySpan<byte> bytes, string extension)
    {
        if (extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
        }

        if (extension.Equals(".png", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 8 &&
                   bytes[0] == 0x89 &&
                   bytes[1] == 0x50 &&
                   bytes[2] == 0x4E &&
                   bytes[3] == 0x47 &&
                   bytes[4] == 0x0D &&
                   bytes[5] == 0x0A &&
                   bytes[6] == 0x1A &&
                   bytes[7] == 0x0A;
        }

        if (extension.Equals(".webp", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 12 &&
                   bytes[0] == 0x52 &&
                   bytes[1] == 0x49 &&
                   bytes[2] == 0x46 &&
                   bytes[3] == 0x46 &&
                   bytes[8] == 0x57 &&
                   bytes[9] == 0x45 &&
                   bytes[10] == 0x42 &&
                   bytes[11] == 0x50;
        }

        if (extension.Equals(".svg", StringComparison.OrdinalIgnoreCase))
        {
            var text = System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
            return text.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ||
                   text.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }
}
