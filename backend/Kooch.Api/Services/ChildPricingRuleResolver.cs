using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ChildPricingRuleResolver(KoochDbContext dbContext) : IChildPricingRuleResolver
{
    public const string FreeChildMaxAgeKey = "reservation.freeChildMaxAge";
    public const string HalfPriceChildMinAgeKey = "reservation.halfPriceChildMinAge";
    public const string HalfPriceChildMaxAgeKey = "reservation.halfPriceChildMaxAge";
    public const string HalfPriceChildRateKey = "reservation.halfPriceChildRate";

    public static readonly string[] SettingKeys =
    [
        FreeChildMaxAgeKey,
        HalfPriceChildMinAgeKey,
        HalfPriceChildMaxAgeKey,
        HalfPriceChildRateKey
    ];

    public async Task<ChildPricingRules> GetGlobalDefaultsAsync(CancellationToken cancellationToken = default)
    {
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && SettingKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        return new ChildPricingRules(
            ParseNullableInt(values, FreeChildMaxAgeKey),
            null,
            ParseNullableInt(values, HalfPriceChildMinAgeKey),
            ParseNullableInt(values, HalfPriceChildMaxAgeKey),
            ParseDecimal(values, HalfPriceChildRateKey, 50m),
            null);
    }

    public ChildPricingRules Resolve(
        int? propertyFreeChildAgeLimit,
        int? propertyMaxFreeChildren,
        decimal? propertyChildPrice,
        ChildPricingRules globalDefaults)
    {
        return globalDefaults with
        {
            FreeChildMaxAge = propertyFreeChildAgeLimit ?? globalDefaults.FreeChildMaxAge,
            MaxFreeChildren = propertyMaxFreeChildren,
            PropertyChildPrice = propertyChildPrice
        };
    }

    public int CountCapacityChildren(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        ChildPricingRules rules)
    {
        return ResolveOccupancy(childAges, requestedChildren, rules).ChargeableChildren;
    }

    public ChildPricingOccupancy ResolveOccupancy(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        ChildPricingRules rules)
    {
        if (requestedChildren <= 0)
        {
            return new ChildPricingOccupancy(0, 0, 0);
        }

        var freeChildren = 0;
        var chargeableChildren = 0;
        var adultEquivalentGuests = 0;
        var ages = NormalizeChildAges(childAges, requestedChildren, rules);
        var halfPriceMinAge = rules.HalfPriceChildMinAge ??
                              (rules.FreeChildMaxAge.HasValue ? rules.FreeChildMaxAge.Value + 1 : 0);
        var halfPriceMaxAge = rules.HalfPriceChildMaxAge ?? 17;

        foreach (var age in ages)
        {
            if (rules.FreeChildMaxAge.HasValue && age <= rules.FreeChildMaxAge.Value)
            {
                freeChildren++;
            }
            else if (age <= halfPriceMaxAge && age >= halfPriceMinAge)
            {
                chargeableChildren++;
            }
            else if (age > halfPriceMaxAge)
            {
                adultEquivalentGuests++;
            }
            else
            {
                freeChildren++;
            }
        }

        return new ChildPricingOccupancy(freeChildren, chargeableChildren, adultEquivalentGuests);
    }

    public decimal ResolveChildPrice(decimal basePrice, ChildPricingRules rules)
    {
        if (rules.PropertyChildPrice.HasValue)
        {
            return rules.PropertyChildPrice.Value;
        }

        return Math.Max(0, basePrice * Math.Clamp(rules.HalfPriceMultiplier, 0m, 1m));
    }

    private static int? ParseNullableInt(Dictionary<string, string> values, string key)
    {
        return values.TryGetValue(key, out var value) &&
               int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static decimal ParseDecimal(Dictionary<string, string> values, string key, decimal fallback)
    {
        return values.TryGetValue(key, out var value) &&
               decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static IReadOnlyList<int> NormalizeChildAges(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        ChildPricingRules rules)
    {
        var fallbackAge = rules.HalfPriceChildMinAge ??
                          (rules.FreeChildMaxAge.HasValue ? rules.FreeChildMaxAge.Value + 1 : 17);
        var ages = childAges
            .Take(requestedChildren)
            .Select(age => Math.Clamp(age, 0, 120))
            .ToList();

        while (ages.Count < requestedChildren)
        {
            ages.Add(Math.Clamp(fallbackAge, 0, 120));
        }

        return ages;
    }
}
