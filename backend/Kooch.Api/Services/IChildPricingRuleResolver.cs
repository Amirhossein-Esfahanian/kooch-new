using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IChildPricingRuleResolver
{
    Task<ChildPricingRules> GetGlobalDefaultsAsync(CancellationToken cancellationToken = default);

    ChildPricingRules Resolve(
        int? propertyFreeChildAgeLimit,
        int? propertyMaxFreeChildren,
        decimal? propertyChildPrice,
        ChildPricingRules globalDefaults);

    int CountCapacityChildren(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        ChildPricingRules rules);

    ChildPricingOccupancy ResolveOccupancy(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        ChildPricingRules rules);

    decimal ResolveChildPrice(decimal basePrice, ChildPricingRules rules);
}

public sealed record ChildPricingRules(
    int? FreeChildMaxAge,
    int? MaxFreeChildren,
    int? HalfPriceChildMinAge,
    int? HalfPriceChildMaxAge,
    decimal HalfPriceChildRate,
    decimal? PropertyChildPrice)
{
    public decimal HalfPriceMultiplier => HalfPriceChildRate > 1m
        ? HalfPriceChildRate / 100m
        : HalfPriceChildRate;
}

public sealed record ChildPricingOccupancy(
    int FreeChildren,
    int ChargeableChildren,
    int AdultEquivalentGuests)
{
    public int CountedChildren => FreeChildren + ChargeableChildren;
}
