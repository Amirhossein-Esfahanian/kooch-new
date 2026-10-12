using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ChildOccupancyEvaluatorTests
{
    private static readonly ChildOccupancyRules Rules = new(6, 7, 12, null);
    private static readonly RoomTypeOccupancyCapacity Capacity = new(2, 2, false, 0);

    [Theory]
    [InlineData(0, 1, 0, 0)]
    [InlineData(6, 1, 0, 0)]
    [InlineData(7, 0, 1, 0)]
    [InlineData(12, 0, 1, 0)]
    [InlineData(13, 0, 0, 1)]
    [InlineData(17, 0, 0, 1)]
    public void Ages_UseResolvedBands(int age, int free, int childRate, int adultEquivalent)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity, 1, [age]);
        Assert.True(result.IsEligible);
        Assert.Equal(1, result.DeclaredChildren);
        Assert.Equal(free, result.FreeChildren);
        Assert.Equal(childRate, result.ChildRateChildren);
        Assert.Equal(adultEquivalent, result.AdultEquivalentChildren);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(18)]
    [InlineData(120)]
    public void InvalidAge_IsRejectedWithoutClamping(int age)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity, 1, [age]);
        Assert.False(result.IsEligible);
        Assert.Equal(ChildOccupancyFailureReason.InvalidChildAge, Assert.Single(result.FailureReasons));
        Assert.Equal(1, result.DeclaredChildren);
        Assert.Equal(0, result.FreeChildren + result.ChildRateChildren + result.AdultEquivalentChildren);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(9)]
    public void EveryNonAdultEquivalentChild_ConsumesChildCapacity(int age)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity with { MaxChildren = 0 }, 2, [age]);
        Assert.False(result.IsEligible);
        Assert.Equal(1, result.NonAdultEquivalentChildren);
        Assert.Equal(ChildOccupancyFailureReason.ChildCapacityExceeded, Assert.Single(result.FailureReasons));
    }

    [Theory]
    [InlineData(1, false, 0, true, 2)]
    [InlineData(2, false, 3, false, 2)]
    [InlineData(2, true, 1, true, 3)]
    [InlineData(2, true, 0, false, 2)]
    public void AdultEquivalentChild_UsesAdultAndEnabledExtraCapacity(
        int adults, bool allowExtra, int extra, bool eligible, int expectedCapacity)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules,
            new(2, 0, allowExtra, extra), adults, [15]);
        Assert.Equal(eligible, result.IsEligible);
        Assert.Equal(adults + 1, result.EffectiveAdultGuests);
        Assert.Equal(expectedCapacity, result.AdultCapacity);
        Assert.Equal(0, result.NonAdultEquivalentChildren);
        if (!eligible)
            Assert.Equal(ChildOccupancyFailureReason.AdultCapacityExceeded, Assert.Single(result.FailureReasons));
    }

    [Theory]
    [InlineData(null, 1, 3, 0)]
    [InlineData(0, 1, 0, 3)]
    [InlineData(1, 1, 1, 2)]
    [InlineData(1, 2, 2, 1)]
    public void FreeQuota_IsPerRoomAndOnlyChangesClassification(
        int? quota, int rooms, int expectedFree, int expectedChildRate)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules with { MaxFreeChildren = quota },
            Capacity with { MaxChildren = 3 }, 2, [4, 5, 6], rooms);
        Assert.True(result.IsEligible);
        Assert.Equal(expectedFree, result.FreeChildren);
        Assert.Equal(expectedChildRate, result.ChildRateChildren);
        Assert.Equal(3, result.NonAdultEquivalentChildren);
        Assert.Equal(0, result.AdultEquivalentChildren);
        Assert.Equal(quota.HasValue ? (long?)quota.Value * rooms : null, result.FreeChildQuota);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(1)]
    public void FreeQuota_CannotExemptChildrenFromOccupancy(int? quota)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules with { MaxFreeChildren = quota },
            Capacity with { MaxChildren = 1 }, 2, [4, 5]);
        Assert.False(result.IsEligible);
        Assert.Equal(2, result.NonAdultEquivalentChildren);
        Assert.Equal(ChildOccupancyFailureReason.ChildCapacityExceeded, Assert.Single(result.FailureReasons));
    }

    [Fact]
    public void MixedAges_ApplyQuotaAfterClassificationWithoutDependingOnOrder()
    {
        var rules = Rules with { MaxFreeChildren = 1 };
        var capacity = new RoomTypeOccupancyCapacity(2, 3, true, 1);
        var first = ChildOccupancyEvaluator.Evaluate(rules, capacity, 2, [4, 5, 9, 15]);
        var reordered = ChildOccupancyEvaluator.Evaluate(rules, capacity, 2, [15, 9, 5, 4]);
        Assert.True(first.IsEligible);
        Assert.Equal(2, first.DeclaredAdults);
        Assert.Equal(4, first.DeclaredChildren);
        Assert.Equal(1, first.FreeChildren);
        Assert.Equal(2, first.ChildRateChildren);
        Assert.Equal(1, first.AdultEquivalentChildren);
        Assert.Equal(3, first.NonAdultEquivalentChildren);
        Assert.Equal(3, first.EffectiveAdultGuests);
        Assert.Equal(first.FreeChildren, reordered.FreeChildren);
        Assert.Equal(first.ChildRateChildren, reordered.ChildRateChildren);
        Assert.Equal(first.AdultEquivalentChildren, reordered.AdultEquivalentChildren);
        Assert.True(reordered.IsEligible);
    }

    [Fact]
    public void TwoRooms_ScaleAdultChildAndExtraCapacity()
    {
        var capacity = new RoomTypeOccupancyCapacity(2, 1, true, 1);
        var result = ChildOccupancyEvaluator.Evaluate(Rules, capacity, 4, [4, 8, 15, 17], 2);
        Assert.True(result.IsEligible);
        Assert.Equal(6, result.AdultCapacity);
        Assert.Equal(2, result.ChildCapacity);
        Assert.Equal(6, result.EffectiveAdultGuests);
        Assert.Equal(2, result.NonAdultEquivalentChildren);
        Assert.False(ChildOccupancyEvaluator.Evaluate(Rules, capacity, 4, [4, 8, 15, 17], 1).IsEligible);
    }

    [Fact]
    public void TwoRooms_WithoutExtraCapacityFitTheConfirmedExample()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, new(2, 1, false, 0), 4, [4, 8], 2);
        Assert.True(result.IsEligible);
        Assert.Equal(4, result.AdultCapacity);
        Assert.Equal(2, result.ChildCapacity);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void InvalidRoomCount_IsRejected(int rooms)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity, 1, [], rooms);
        Assert.Equal(ChildOccupancyFailureReason.InvalidRoomCount, Assert.Single(result.FailureReasons));
        Assert.False(result.IsEligible);
    }

    [Fact]
    public void NegativeAdults_AreRejected()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity, -1, []);
        Assert.Equal(ChildOccupancyFailureReason.InvalidAdultCount, Assert.Single(result.FailureReasons));
        Assert.False(result.IsEligible);
    }

    [Fact]
    public void ZeroAdults_DoesNotIntroduceSupervisionValidation()
    {
        Assert.True(ChildOccupancyEvaluator.Evaluate(Rules, Capacity, 0, [4, 9]).IsEligible);
    }

    [Fact]
    public void EmptyAgeList_DefinesZeroChildren()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, Capacity, 2, []);
        Assert.True(result.IsEligible);
        Assert.Equal(0, result.DeclaredChildren);
        Assert.Equal(0, result.NonAdultEquivalentChildren);
        Assert.Equal(0, result.AdultEquivalentChildren);
    }

    [Theory]
    [InlineData(4, 1, 2, false)]
    [InlineData(2, 3, 3, true)]
    public void MaxChildren_IsIndependentOfMaxAdultsMinusOne(
        int maxAdults, int maxChildren, int childCount, bool eligible)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, new(maxAdults, maxChildren, false, 0),
            1, Enumerable.Repeat(4, childCount).ToArray());
        Assert.Equal(eligible, result.IsEligible);
        Assert.Equal(maxChildren, result.ChildCapacity);
    }

    [Fact]
    public void BothExceededCapacities_ReturnBothReasons()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, new(1, 0, false, 0), 2, [4]);
        Assert.Equal(new[] { ChildOccupancyFailureReason.AdultCapacityExceeded,
            ChildOccupancyFailureReason.ChildCapacityExceeded }, result.FailureReasons);
    }

    [Fact]
    public void CustomResolvedBoundaries_AreUsedInsteadOfSeedDefaults()
    {
        var result = ChildOccupancyEvaluator.Evaluate(new(3, 4, 8, null),
            new(3, 2, false, 0), 1, [3, 4, 9]);
        Assert.True(result.IsEligible);
        Assert.Equal(1, result.FreeChildren);
        Assert.Equal(1, result.ChildRateChildren);
        Assert.Equal(1, result.AdultEquivalentChildren);
    }

    [Fact]
    public void NullBoundaries_UseTheExistingResolverFallbacks()
    {
        var withFreeBoundary = ChildOccupancyEvaluator.Evaluate(new(3, null, null, null),
            Capacity, 1, [3, 17]);
        Assert.Equal(1, withFreeBoundary.FreeChildren);
        Assert.Equal(1, withFreeBoundary.ChildRateChildren);
        var unset = ChildOccupancyEvaluator.Evaluate(new(null, null, null, null), Capacity, 1, [0, 17]);
        Assert.Equal(0, unset.FreeChildren);
        Assert.Equal(2, unset.ChildRateChildren);
    }

    [Fact]
    public void ResolvedMapping_ExcludesMonetaryRules()
    {
        var resolved = new ChildPricingRules(6, 1, 7, 12, 50, 100m);
        var mapped = ChildOccupancyRules.FromResolved(resolved);
        Assert.Equal(new ChildOccupancyRules(6, 7, 12, 1), mapped);
        Assert.Equal(mapped, ChildOccupancyRules.FromResolved(resolved with
            { HalfPriceChildRate = 10, PropertyChildPrice = 900m }));
    }

    [Fact]
    public void LargeCapacityScaling_DoesNotOverflowInt32()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules with { MaxFreeChildren = int.MaxValue },
            new(int.MaxValue, int.MaxValue, true, int.MaxValue), 1, [], 2);
        Assert.True(result.IsEligible);
        Assert.Equal(4L * int.MaxValue, result.AdultCapacity);
        Assert.Equal(2L * int.MaxValue, result.ChildCapacity);
        Assert.Equal(2L * int.MaxValue, result.FreeChildQuota);
    }

    [Theory]
    [InlineData(-1, 1, 0)]
    [InlineData(1, -1, 0)]
    [InlineData(1, 1, -1)]
    public void NegativeCapacity_IsRejected(int maxAdults, int maxChildren, int extra)
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules, new(maxAdults, maxChildren, true, extra), 0, []);
        Assert.Equal(ChildOccupancyFailureReason.InvalidCapacity, Assert.Single(result.FailureReasons));
    }

    [Fact]
    public void NegativeFreeQuota_IsRejected()
    {
        var result = ChildOccupancyEvaluator.Evaluate(Rules with { MaxFreeChildren = -1 }, Capacity, 0, []);
        Assert.Equal(ChildOccupancyFailureReason.InvalidFreeChildQuota, Assert.Single(result.FailureReasons));
    }
}
