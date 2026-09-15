using System.Globalization;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.ReservationSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/reservation-settings")]
public class AdminReservationSettingsController(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IChildPricingRuleResolver childPricingRuleResolver) : AuthenticatedControllerBase
{
    private static readonly string[] DeadlineSettingKeys =
    [
        ReservationPaymentWindowSettings.SettingKey,
        ReservationOwnerApprovalWindowSettings.SettingKey,
        ReservationOwnerApprovalReminderSettings.SettingKey
    ];

    [HttpGet]
    [ProducesResponseType<ReservationSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationSettingsResponse>> Get(CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        var defaults = await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken);

        return Ok(new ReservationSettingsResponse(
            defaults.FreeChildMaxAge,
            defaults.HalfPriceChildMinAge,
            defaults.HalfPriceChildMaxAge,
            defaults.HalfPriceChildRate));
    }

    [HttpPut]
    [ProducesResponseType<ReservationSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationSettingsResponse>> Update(
        UpdateReservationSettingsRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        Validate(request);

        var values = new Dictionary<string, string>
        {
            [ChildPricingRuleResolver.FreeChildMaxAgeKey] = Format(request.FreeChildMaxAge),
            [ChildPricingRuleResolver.HalfPriceChildMinAgeKey] = Format(request.HalfPriceChildMinAge),
            [ChildPricingRuleResolver.HalfPriceChildMaxAgeKey] = Format(request.HalfPriceChildMaxAge),
            [ChildPricingRuleResolver.HalfPriceChildRateKey] = request.HalfPriceChildRate.ToString(CultureInfo.InvariantCulture)
        };

        var settings = await dbContext.SiteSettings
            .Where(setting => ChildPricingRuleResolver.SettingKeys.Contains(setting.Key))
            .ToListAsync(cancellationToken);

        foreach (var (key, value) in values)
        {
            var setting = settings.SingleOrDefault(item => item.Key == key)
                ?? throw new KeyNotFoundException("Reservation setting was not found.");
            setting.Value = value;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new ReservationSettingsResponse(
            request.FreeChildMaxAge,
            request.HalfPriceChildMinAge,
            request.HalfPriceChildMaxAge,
            request.HalfPriceChildRate));
    }

    [HttpGet("deadlines")]
    [ProducesResponseType<ReservationDeadlineSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationDeadlineSettingsResponse>> GetDeadlines(
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);

        return Ok(new ReservationDeadlineSettingsResponse(
            await ReservationPaymentWindowSettings.GetMinutesAsync(dbContext, cancellationToken),
            await ReservationOwnerApprovalWindowSettings.GetMinutesAsync(dbContext, cancellationToken),
            await ReservationOwnerApprovalReminderSettings.GetMinutesAsync(dbContext, cancellationToken)));
    }

    [HttpPut("deadlines")]
    [ProducesResponseType<ReservationDeadlineSettingsResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReservationDeadlineSettingsResponse>> UpdateDeadlines(
        UpdateReservationDeadlineSettingsRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageSettingsAsync(cancellationToken);
        ValidateDeadline(request.PaymentWindowMinutes, nameof(request.PaymentWindowMinutes));
        ValidateDeadline(request.OwnerApprovalWindowMinutes, nameof(request.OwnerApprovalWindowMinutes));
        ValidateDeadline(
            request.OwnerApprovalReminderIntervalMinutes,
            nameof(request.OwnerApprovalReminderIntervalMinutes));

        var values = new Dictionary<string, string>
        {
            [ReservationPaymentWindowSettings.SettingKey] =
                request.PaymentWindowMinutes.ToString(CultureInfo.InvariantCulture),
            [ReservationOwnerApprovalWindowSettings.SettingKey] =
                request.OwnerApprovalWindowMinutes.ToString(CultureInfo.InvariantCulture),
            [ReservationOwnerApprovalReminderSettings.SettingKey] =
                request.OwnerApprovalReminderIntervalMinutes.ToString(CultureInfo.InvariantCulture)
        };
        var settings = await dbContext.SiteSettings
            .Where(setting => DeadlineSettingKeys.Contains(setting.Key))
            .ToListAsync(cancellationToken);

        if (settings.Count != DeadlineSettingKeys.Length)
        {
            throw new KeyNotFoundException("Reservation deadline setting was not found.");
        }

        foreach (var setting in settings)
        {
            setting.Value = values[setting.Key];
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new ReservationDeadlineSettingsResponse(
            request.PaymentWindowMinutes,
            request.OwnerApprovalWindowMinutes,
            request.OwnerApprovalReminderIntervalMinutes));
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
            throw new UnauthorizedAccessException("You do not have permission to manage reservation settings.");
        }
    }

    private static void Validate(UpdateReservationSettingsRequest request)
    {
        ValidateAge(request.FreeChildMaxAge, nameof(request.FreeChildMaxAge));
        ValidateAge(request.HalfPriceChildMinAge, nameof(request.HalfPriceChildMinAge));
        ValidateAge(request.HalfPriceChildMaxAge, nameof(request.HalfPriceChildMaxAge));

        if (request.HalfPriceChildMinAge.HasValue &&
            request.HalfPriceChildMaxAge.HasValue &&
            request.HalfPriceChildMinAge.Value > request.HalfPriceChildMaxAge.Value)
        {
            throw new ArgumentException("Half-price child minimum age cannot be greater than maximum age.");
        }

        if (request.HalfPriceChildRate is < 0 or > 100)
        {
            throw new ArgumentException("Half-price child rate must be between 0 and 100.");
        }
    }

    private static void ValidateAge(int? age, string fieldName)
    {
        if (age is < 0 or > 17)
        {
            throw new ArgumentException($"{fieldName} must be between 0 and 17.");
        }
    }

    private static void ValidateDeadline(int value, string fieldName)
    {
        if (value is < 1 or > ReservationPaymentWindowSettings.MaximumMinutes)
        {
            throw new ArgumentException(
                $"{fieldName} must be between 1 and {ReservationPaymentWindowSettings.MaximumMinutes}.");
        }
    }

    private static string Format(int? value) =>
        value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : string.Empty;
}
