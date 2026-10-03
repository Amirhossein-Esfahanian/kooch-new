using Kooch.Api.Data;
using Kooch.Api.Dtos.Cashback;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface ICashbackSettingsService
{
    Task<CashbackPolicyResponse> GetGlobalAsync(string currency, CancellationToken cancellationToken = default);
    Task<CashbackPolicyResponse> UpdateGlobalAsync(UpdateCashbackPolicyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyCashbackResponse> GetPropertyAsync(int propertyId, string currency, CancellationToken cancellationToken = default);
    Task<PropertyCashbackResponse> UpdatePropertyAsync(int propertyId, UpdatePropertyCashbackRequest request, CancellationToken cancellationToken = default);
    Task<CashbackPolicyResponse> GetEffectiveCashbackPolicyAsync(int propertyId, string currency, CancellationToken cancellationToken = default);
}

public sealed class CashbackSettingsService(KoochDbContext dbContext) : ICashbackSettingsService
{
    public async Task<CashbackPolicyResponse> GetGlobalAsync(string currency, CancellationToken cancellationToken = default)
    {
        currency = NormalizeCurrency(currency);
        var setting = await dbContext.CashbackSettings.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PropertyId == null && item.Currency == currency, cancellationToken);
        return ToResponse(setting, CashbackPolicySource.Global, currency);
    }

    public async Task<CashbackPolicyResponse> UpdateGlobalAsync(UpdateCashbackPolicyRequest request, CancellationToken cancellationToken = default)
    {
        var currency = NormalizeCurrency(request.Currency);
        ValidatePolicy(request.Enabled, request.CalculationMode, request.PercentageRate,
            request.SpendUnitAmount, request.RewardAmount, request.MaxCashbackPerReservation, request.ExpiryDays);
        var setting = await dbContext.CashbackSettings.SingleOrDefaultAsync(
            item => item.PropertyId == null && item.Currency == currency, cancellationToken);
        if (setting is null)
        {
            setting = new CashbackSetting { Currency = currency };
            dbContext.CashbackSettings.Add(setting);
        }
        Apply(setting, request.Enabled, request.CalculationMode, request.PercentageRate,
            request.SpendUnitAmount, request.RewardAmount, request.MaxCashbackPerReservation, request.ExpiryDays);
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToResponse(setting, CashbackPolicySource.Global, currency);
    }

    public async Task<PropertyCashbackResponse> GetPropertyAsync(int propertyId, string currency, CancellationToken cancellationToken = default)
    {
        currency = NormalizeCurrency(currency);
        await EnsurePropertyExistsAsync(propertyId, cancellationToken);
        var setting = await dbContext.CashbackSettings.AsNoTracking().SingleOrDefaultAsync(
            item => item.PropertyId == propertyId && item.Currency == currency, cancellationToken);
        return new PropertyCashbackResponse(
            setting is null ? PropertyCashbackState.Inherit : setting.Enabled ? PropertyCashbackState.EnabledOverride : PropertyCashbackState.Disabled,
            await GetEffectiveCashbackPolicyAsync(propertyId, currency, cancellationToken));
    }

    public async Task<PropertyCashbackResponse> UpdatePropertyAsync(int propertyId, UpdatePropertyCashbackRequest request, CancellationToken cancellationToken = default)
    {
        var currency = NormalizeCurrency(request.Currency);
        if (!Enum.IsDefined(request.State)) throw new ArgumentException("Property cashback state is invalid.");
        var enabled = request.State == PropertyCashbackState.EnabledOverride;
        ValidatePolicy(enabled, request.CalculationMode, request.PercentageRate,
            request.SpendUnitAmount, request.RewardAmount, request.MaxCashbackPerReservation, request.ExpiryDays);
        await EnsurePropertyExistsAsync(propertyId, cancellationToken);
        var setting = await dbContext.CashbackSettings.SingleOrDefaultAsync(
            item => item.PropertyId == propertyId && item.Currency == currency, cancellationToken);
        if (request.State == PropertyCashbackState.Inherit)
        {
            if (setting is not null) dbContext.CashbackSettings.Remove(setting);
        }
        else
        {
            if (setting is null)
            {
                setting = new CashbackSetting { PropertyId = propertyId, Currency = currency };
                dbContext.CashbackSettings.Add(setting);
            }
            Apply(setting, enabled, request.CalculationMode, request.PercentageRate,
                request.SpendUnitAmount, request.RewardAmount, request.MaxCashbackPerReservation, request.ExpiryDays);
        }
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetPropertyAsync(propertyId, currency, cancellationToken);
    }

    public async Task<CashbackPolicyResponse> GetEffectiveCashbackPolicyAsync(int propertyId, string currency, CancellationToken cancellationToken = default)
    {
        currency = NormalizeCurrency(currency);
        await EnsurePropertyExistsAsync(propertyId, cancellationToken);
        var propertySetting = await dbContext.CashbackSettings.AsNoTracking().SingleOrDefaultAsync(
            item => item.PropertyId == propertyId && item.Currency == currency, cancellationToken);
        if (propertySetting is not null)
            return ToResponse(propertySetting,
                propertySetting.Enabled ? CashbackPolicySource.PropertyOverride : CashbackPolicySource.PropertyDisabled,
                currency);
        return await GetGlobalAsync(currency, cancellationToken);
    }

    private async Task EnsurePropertyExistsAsync(int propertyId, CancellationToken cancellationToken)
    {
        if (!await dbContext.Properties.AnyAsync(property => property.Id == propertyId, cancellationToken))
            throw new KeyNotFoundException("Property was not found.");
    }

    private static string NormalizeCurrency(string? currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        if (normalized is null || normalized.Length != 3 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("Currency must be a three-letter code.");
        return normalized;
    }

    private static void ValidatePolicy(bool enabled, CashbackCalculationMode? mode, decimal? rate,
        decimal? spendUnit, decimal? reward, decimal? cap, int? expiryDays)
    {
        if (!enabled)
        {
            if (mode is not null || rate is not null || spendUnit is not null || reward is not null || cap is not null || expiryDays is not null)
                throw new ArgumentException("Disabled cashback must not include calculation fields.");
            return;
        }
        if (cap is null or <= 0 || expiryDays is null or <= 0)
            throw new ArgumentException("Enabled cashback requires a positive cap and expiry duration.");
        if (rate.HasValue && decimal.Round(rate.Value, 2) != rate.Value ||
            spendUnit.HasValue && decimal.Round(spendUnit.Value, 2) != spendUnit.Value ||
            reward.HasValue && decimal.Round(reward.Value, 2) != reward.Value ||
            cap.HasValue && decimal.Round(cap.Value, 2) != cap.Value)
            throw new ArgumentException("Cashback rates and amounts support at most two decimal places.");
        switch (mode)
        {
            case CashbackCalculationMode.Percentage when rate is > 0 and <= 20 && spendUnit is null && reward is null:
            case CashbackCalculationMode.FixedPerUnit when spendUnit is > 0 && reward is > 0 && rate is null:
                return;
            default:
                throw new ArgumentException("Cashback calculation mode or its fields are invalid.");
        }
    }

    private static void Apply(CashbackSetting setting, bool enabled, CashbackCalculationMode? mode, decimal? rate,
        decimal? spendUnit, decimal? reward, decimal? cap, int? expiryDays)
    {
        setting.Enabled = enabled;
        setting.CalculationMode = enabled ? mode : null;
        setting.PercentageRate = enabled ? rate : null;
        setting.SpendUnitAmount = enabled ? spendUnit : null;
        setting.RewardAmount = enabled ? reward : null;
        setting.MaxCashbackPerReservation = enabled ? cap : null;
        setting.ExpiryDays = enabled ? expiryDays : null;
    }

    private static CashbackPolicyResponse ToResponse(CashbackSetting? setting, CashbackPolicySource source, string currency) =>
        new(setting?.Enabled == true, source, currency, setting?.CalculationMode, setting?.PercentageRate,
            setting?.SpendUnitAmount, setting?.RewardAmount, setting?.MaxCashbackPerReservation, setting?.ExpiryDays);
}
