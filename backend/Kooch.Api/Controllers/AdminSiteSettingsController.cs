using System.Globalization;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.SiteSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.SiteSettings;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/site-settings")]
public class AdminSiteSettingsController(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    ISiteSettingUploadService uploadService) : AuthenticatedControllerBase
{
    private static readonly HashSet<string> CommissionKeys = new(StringComparer.Ordinal)
    {
        "ReservationCommissionPercent",
        "ReferralCommissionPercent",
        "CommissionType3Percent"
    };
    private static readonly HashSet<string> SpecializedSettingKeys = new(StringComparer.Ordinal)
    {
        ChildPricingRuleResolver.FreeChildMaxAgeKey,
        ChildPricingRuleResolver.HalfPriceChildMinAgeKey,
        ChildPricingRuleResolver.HalfPriceChildMaxAgeKey,
        ChildPricingRuleResolver.HalfPriceChildRateKey,
        ReservationPaymentWindowSettings.SettingKey,
        ReservationOwnerApprovalWindowSettings.SettingKey,
        ReservationOwnerApprovalReminderSettings.SettingKey
    };

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<SiteSettingResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<SiteSettingResponse>>> Get(CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);

        var settings = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => !SpecializedSettingKeys.Contains(setting.Key))
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

        if (SpecializedSettingKeys.Contains(key))
        {
            throw new InvalidOperationException(
                "This setting is managed through the reservation settings endpoint.");
        }

        var setting = await dbContext.SiteSettings
            .SingleOrDefaultAsync(setting => setting.Key == key, cancellationToken)
            ?? throw new KeyNotFoundException("Site setting was not found.");

        var value = request.Value?.Trim() ?? string.Empty;
        if (setting.Key is "image.maxFileSizeMb" or "image.minWidth" or "image.minHeight" or "image.maxImagesPerProperty")
        {
            if (!int.TryParse(value, out var number) || number <= 0)
            {
                throw new ArgumentException("مقدار تنظیم تصویر باید عددی بزرگ‌تر از صفر باشد.");
            }
        }
        else if (setting.Key == "image.enableWebpConversion" && !bool.TryParse(value, out _))
        {
            throw new ArgumentException("مقدار تبدیل WebP معتبر نیست.");
        }
        else if (setting.Key is "pricing.minPrice" or "pricing.maxPrice")
        {
            if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var price) || price < 0)
            {
                throw new ArgumentException("محدوده قیمت معتبر نیست.");
            }
            var otherKey = setting.Key == "pricing.minPrice" ? "pricing.maxPrice" : "pricing.minPrice";
            var otherValue = await dbContext.SiteSettings.AsNoTracking()
                .Where(item => item.Key == otherKey)
                .Select(item => item.Value)
                .SingleAsync(cancellationToken);
            var otherPrice = decimal.Parse(otherValue, CultureInfo.InvariantCulture);
            if ((setting.Key == "pricing.minPrice" && price > otherPrice) ||
                (setting.Key == "pricing.maxPrice" && price < otherPrice))
            {
                throw new ArgumentException("حداقل قیمت نمی‌تواند بیشتر از حداکثر قیمت باشد.");
            }
        }
        else if (CommissionKeys.Contains(setting.Key))
        {
            if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var percent) || percent < 0 || percent > 100)
            {
                throw new ArgumentException("درصد کمیسیون باید بین ۰ تا ۱۰۰ باشد.");
            }
        }
        setting.Value = value;
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
        var setting = await uploadService.UploadAsync(key, file, cancellationToken);
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
