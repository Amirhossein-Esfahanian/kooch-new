using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class CommissionPolicyResolver(KoochDbContext dbContext) : ICommissionPolicyResolver
{
    public const string DirectSettingKey = "ReservationCommissionPercent";
    public const string PropertyReferralLinkSettingKey = "ReferralCommissionPercent";
    public const string PropertyReferralCodeSettingKey = "CommissionType3Percent";

    public async Task<CommissionCalculationResult> ResolveAsync(
        Reservation reservation,
        decimal grossAmount,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(reservation);
        if (grossAmount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(grossAmount), "Gross amount cannot be negative.");
        }

        var propertyOverride = await dbContext.PropertyCommissionRates.AsNoTracking()
            .SingleOrDefaultAsync(
                rate => rate.PropertyId == reservation.PropertyId &&
                        rate.CommissionType == reservation.CommissionType &&
                        rate.IsEnabled,
                cancellationToken);

        decimal rate;
        CommissionRateSource rateSource;
        string policySource;
        string policyVersion;
        if (propertyOverride is not null)
        {
            rate = ValidateRate(propertyOverride.Rate, $"PropertyCommissionRate:{propertyOverride.Id}");
            rateSource = CommissionRateSource.PropertyOverride;
            policySource = $"PropertyCommissionRate:{propertyOverride.Id}";
            policyVersion = FormatPolicyVersion(propertyOverride.UpdatedAtUtc ?? propertyOverride.CreatedAtUtc);
        }
        else
        {
            var settingKey = GetGlobalSettingKey(reservation.CommissionType);
            var setting = await dbContext.SiteSettings.AsNoTracking()
                .SingleOrDefaultAsync(
                    candidate => candidate.Key == settingKey && candidate.IsActive,
                    cancellationToken)
                ?? throw new KeyNotFoundException($"Commission setting '{settingKey}' was not found or is inactive.");

            if (!decimal.TryParse(
                    setting.Value,
                    NumberStyles.Number,
                    CultureInfo.InvariantCulture,
                    out var parsedRate))
            {
                throw new InvalidOperationException($"Commission setting '{settingKey}' is malformed.");
            }

            rate = ValidateRate(parsedRate, settingKey);
            rateSource = CommissionRateSource.Global;
            policySource = setting.Key;
            policyVersion = FormatPolicyVersion(setting.UpdatedAtUtc ?? setting.CreatedAtUtc);
        }

        var rawCommission = grossAmount * rate / 100m;
        var commissionAmount = decimal.Round(rawCommission, 2, MidpointRounding.AwayFromZero);
        var propertyPayableAmount = grossAmount - commissionAmount;

        return new CommissionCalculationResult(
            reservation.CommissionType,
            rateSource,
            rate,
            grossAmount,
            grossAmount,
            commissionAmount,
            propertyPayableAmount,
            policySource,
            policyVersion);
    }

    private static string GetGlobalSettingKey(CommissionType commissionType) =>
        commissionType switch
        {
            CommissionType.Direct => DirectSettingKey,
            CommissionType.PropertyReferralLink => PropertyReferralLinkSettingKey,
            CommissionType.PropertyReferralCode => PropertyReferralCodeSettingKey,
            _ => throw new InvalidOperationException($"Unsupported commission type '{commissionType}'.")
        };

    private static decimal ValidateRate(decimal rate, string policySource)
    {
        if (rate is < 0 or > 100)
        {
            throw new InvalidOperationException($"Commission rate from '{policySource}' must be between 0 and 100.");
        }

        return rate;
    }

    private static string FormatPolicyVersion(DateTime timestamp) =>
        timestamp.ToString("O", CultureInfo.InvariantCulture);
}
