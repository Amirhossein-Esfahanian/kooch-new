namespace Kooch.Api.Services;

public sealed record ChildOccupancyRules(
    int? FreeChildMaxAge,
    int? HalfPriceChildMinAge,
    int? HalfPriceChildMaxAge,
    int? MaxFreeChildren)
{
    public static ChildOccupancyRules FromResolved(ChildPricingRules rules)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return new(rules.FreeChildMaxAge, rules.HalfPriceChildMinAge,
            rules.HalfPriceChildMaxAge, rules.MaxFreeChildren);
    }
}

public sealed record RoomTypeOccupancyCapacity(
    int MaxAdults,
    int MaxChildren,
    bool AllowExtraGuest,
    int MaxExtraGuests);

public enum ChildOccupancyFailureReason
{
    InvalidRoomCount,
    InvalidAdultCount,
    InvalidChildAge,
    InvalidCapacity,
    InvalidFreeChildQuota,
    AdultCapacityExceeded,
    ChildCapacityExceeded
}

public sealed record ChildOccupancyResult(
    int DeclaredAdults,
    int DeclaredChildren,
    int FreeChildren,
    int ChildRateChildren,
    int AdultEquivalentChildren,
    int NonAdultEquivalentChildren,
    long EffectiveAdultGuests,
    long AdultCapacity,
    long ChildCapacity,
    long? FreeChildQuota,
    IReadOnlyList<ChildOccupancyFailureReason> FailureReasons)
{
    public bool IsEligible => FailureReasons.Count == 0;
}

/// <summary>Aggregate occupancy for identical rooms; no inventory or monetary calculation.</summary>
public static class ChildOccupancyEvaluator
{
    public static ChildOccupancyResult Evaluate(
        ChildOccupancyRules rules,
        RoomTypeOccupancyCapacity capacity,
        int declaredAdults,
        IReadOnlyList<int> childAges,
        int roomCount = 1)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(capacity);
        ArgumentNullException.ThrowIfNull(childAges);

        var failures = new List<ChildOccupancyFailureReason>();
        if (roomCount <= 0) failures.Add(ChildOccupancyFailureReason.InvalidRoomCount);
        if (declaredAdults < 0) failures.Add(ChildOccupancyFailureReason.InvalidAdultCount);
        if (childAges.Any(age => age is < 0 or > 17))
            failures.Add(ChildOccupancyFailureReason.InvalidChildAge);
        if (capacity.MaxAdults < 0 || capacity.MaxChildren < 0 || capacity.MaxExtraGuests < 0)
            failures.Add(ChildOccupancyFailureReason.InvalidCapacity);
        if (rules.MaxFreeChildren is < 0)
            failures.Add(ChildOccupancyFailureReason.InvalidFreeChildQuota);

        // Invalid input is not classified or repaired. Counts/capacities are unevaluated zeros.
        if (failures.Count > 0)
            return new(declaredAdults, childAges.Count, 0, 0, 0, 0, 0, 0, 0, null,
                failures.AsReadOnly());

        // Match ResolveOccupancy's resolved boundary semantics, including its null fallbacks.
        var childRateMinAge = rules.HalfPriceChildMinAge ??
            (rules.FreeChildMaxAge.HasValue ? (long)rules.FreeChildMaxAge.Value + 1 : 0);
        var childRateMaxAge = rules.HalfPriceChildMaxAge ?? 17;
        var freeCandidates = 0;
        var childRateChildren = 0;
        var adultEquivalentChildren = 0;
        foreach (var age in childAges)
        {
            if (age < childRateMinAge) freeCandidates++;
            else if (age <= childRateMaxAge) childRateChildren++;
            else adultEquivalentChildren++;
        }

        // Quota changes price classification only; every non-adult-equivalent child uses capacity.
        long? freeQuota = rules.MaxFreeChildren.HasValue
            ? (long)rules.MaxFreeChildren.Value * roomCount
            : null;
        var freeChildren = freeQuota.HasValue
            ? (int)Math.Min(freeCandidates, freeQuota.Value)
            : freeCandidates;
        childRateChildren += freeCandidates - freeChildren;
        var nonAdultEquivalentChildren = freeChildren + childRateChildren;
        var effectiveAdults = (long)declaredAdults + adultEquivalentChildren;
        var adultCapacity = ((long)capacity.MaxAdults +
            (capacity.AllowExtraGuest ? capacity.MaxExtraGuests : 0)) * roomCount;
        var childCapacity = (long)capacity.MaxChildren * roomCount;

        if (effectiveAdults > adultCapacity)
            failures.Add(ChildOccupancyFailureReason.AdultCapacityExceeded);
        if (nonAdultEquivalentChildren > childCapacity)
            failures.Add(ChildOccupancyFailureReason.ChildCapacityExceeded);

        return new(declaredAdults, childAges.Count, freeChildren, childRateChildren,
            adultEquivalentChildren, nonAdultEquivalentChildren, effectiveAdults,
            adultCapacity, childCapacity, freeQuota, failures.AsReadOnly());
    }
}
