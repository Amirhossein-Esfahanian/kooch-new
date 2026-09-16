using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.SiteSettings;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PricingBoundsService(KoochDbContext dbContext) : IPricingBoundsService
{
    public const string MinimumPriceKey = "pricing.minPrice";
    public const string MaximumPriceKey = "pricing.maxPrice";

    private static readonly string[] SettingKeys = [MinimumPriceKey, MaximumPriceKey];

    public async Task<PricingBoundsResponse> GetAsync(CancellationToken cancellationToken = default)
    {
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => SettingKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        EnsureComplete(values.Count);
        return new PricingBoundsResponse(
            ParseStoredValue(values[MinimumPriceKey], MinimumPriceKey),
            ParseStoredValue(values[MaximumPriceKey], MaximumPriceKey));
    }

    public async Task<PricingBoundsResponse> UpdateAsync(
        UpdatePricingBoundsRequest request,
        CancellationToken cancellationToken = default)
    {
        var target = Validate(request);
        var settings = await dbContext.SiteSettings
            .Where(setting => SettingKeys.Contains(setting.Key))
            .ToListAsync(cancellationToken);

        EnsureComplete(settings.Count);

        settings.Single(setting => setting.Key == MinimumPriceKey).Value =
            target.MinPrice.ToString(CultureInfo.InvariantCulture);
        settings.Single(setting => setting.Key == MaximumPriceKey).Value =
            target.MaxPrice.ToString(CultureInfo.InvariantCulture);

        await dbContext.SaveChangesAsync(cancellationToken);
        return target;
    }

    private static PricingBoundsResponse Validate(UpdatePricingBoundsRequest request)
    {
        if (!request.MinPrice.HasValue || !request.MaxPrice.HasValue)
        {
            throw new ArgumentException("Minimum and maximum prices are required.");
        }

        var minimum = request.MinPrice.Value;
        var maximum = request.MaxPrice.Value;
        if (minimum < 0 || maximum < 0)
        {
            throw new ArgumentException("Pricing bounds cannot be negative.");
        }

        if (minimum > maximum)
        {
            throw new ArgumentException("Minimum price cannot be greater than maximum price.");
        }

        return new PricingBoundsResponse(minimum, maximum);
    }

    private static decimal ParseStoredValue(string value, string key)
    {
        if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            throw new InvalidOperationException($"Stored pricing bound '{key}' is malformed.");
        }

        return parsed;
    }

    private static void EnsureComplete(int count)
    {
        if (count != SettingKeys.Length)
        {
            throw new KeyNotFoundException("Pricing bound setting was not found.");
        }
    }
}
