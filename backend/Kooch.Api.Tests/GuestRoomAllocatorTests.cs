using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestRoomAllocatorTests
{
    private static readonly ChildOccupancyRules Rules = new(6, 7, 12, null);

    private static GuestRoomTypeSelection Rooms(
        int roomTypeId, int quantity, int maxAdults, int maxChildren = 0,
        bool allowExtraGuest = false, int maxExtraGuests = 0) =>
        new(roomTypeId, new(maxAdults, maxChildren, allowExtraGuest, maxExtraGuests), quantity);

    [Fact]
    public void FourAdults_FitTwoTwoPersonRooms_ExactlyOnce()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 4, [], [Rooms(10, 2, 2)]);

        Assert.True(result.IsValid);
        Assert.Equal([2, 2], result.Rooms.Select(room => room.Adults));
        Assert.Equal([0, 1], result.Rooms.Select(room => room.SelectedRoomIndex));
        Assert.All(result.Rooms, room => Assert.Equal(10, room.RoomTypeId));
    }

    [Fact]
    public void TwoAdults_FitOneFourPersonRoom_WithoutFillingIt()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 2, [], [Rooms(10, 1, 4)]);

        Assert.True(result.IsValid);
        Assert.Equal(2, Assert.Single(result.Rooms).Adults);
    }

    [Fact]
    public void MixedRoomTypesAndQuantities_AllocateTheWholePartyOnce()
    {
        var selections = new[] { Rooms(10, 2, 2, 1), Rooms(20, 1, 3, 2) };
        var result = GuestRoomAllocator.Allocate(Rules, 6, [4, 9, 15], selections);

        Assert.True(result.IsValid);
        Assert.Equal([10, 10, 20], result.Rooms.Select(room => room.RoomTypeId));
        Assert.Equal(6, result.Rooms.Sum(room => room.Adults));
        Assert.Equal(new[] { 4, 9, 15 }, result.Rooms.SelectMany(room => room.ChildAges).Order());
        Assert.All(result.Rooms, room => Assert.True(ChildOccupancyEvaluator.Evaluate(
            Rules, selections.Single(selection => selection.RoomTypeId == room.RoomTypeId).Capacity,
            room.Adults, room.ChildAges).IsEligible));
    }

    [Fact]
    public void FreeAndHalfPriceChildren_UseChildLimitWithoutConsumingAdultCapacity()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 2, [4, 9], [Rooms(10, 1, 2, 2)]);

        Assert.True(result.IsValid);
        var room = Assert.Single(result.Rooms);
        Assert.Equal(2, room.Adults);
        Assert.Equal([4, 9], room.ChildAges);
        var occupancy = ChildOccupancyEvaluator.Evaluate(Rules, new(2, 2, false, 0),
            room.Adults, room.ChildAges);
        Assert.Equal(2, occupancy.EffectiveAdultGuests);
        Assert.Equal(1, occupancy.FreeChildren);
        Assert.Equal(1, occupancy.ChildRateChildren);
    }

    [Fact]
    public void OlderChild_UsesAdultEquivalentCapacity()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 2, [13], [Rooms(10, 2, 2)]);

        Assert.True(result.IsValid);
        Assert.Equal(2, result.Rooms.Sum(room => room.Adults));
        Assert.Equal([13], result.Rooms.SelectMany(room => room.ChildAges));
        Assert.All(result.Rooms, room => Assert.True(ChildOccupancyEvaluator.Evaluate(
            Rules, new(2, 0, false, 0), room.Adults, room.ChildAges).IsEligible));
        Assert.Equal(GuestRoomAllocationFailure.InsufficientCapacity,
            GuestRoomAllocator.Allocate(Rules, 2, [13], [Rooms(10, 1, 2)]).Failure);
    }

    [Fact]
    public void PropertyResolvedAgeThreshold_IsUsedWithoutHardCodedBands()
    {
        var propertyRules = ChildOccupancyRules.FromResolved(
            new ChildPricingRules(3, 1, 4, 12, 50m, null));
        var result = GuestRoomAllocator.Allocate(propertyRules, 1, [3, 4], [Rooms(10, 1, 1, 2)]);

        Assert.True(result.IsValid);
        var room = Assert.Single(result.Rooms);
        var occupancy = ChildOccupancyEvaluator.Evaluate(propertyRules,
            new(1, 2, false, 0), room.Adults, room.ChildAges);
        Assert.Equal(1, occupancy.FreeChildren);
        Assert.Equal(1, occupancy.ChildRateChildren);
    }

    [Fact]
    public void MaxChildren_IsEnforcedEvenForDiscountedChildren()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 2, [4, 9], [Rooms(10, 1, 2, 1)]);

        Assert.False(result.IsValid);
        Assert.Equal(GuestRoomAllocationFailure.InsufficientCapacity, result.Failure);
        Assert.Empty(result.Rooms);
    }

    [Fact]
    public void InsufficientAggregateAdultCapacity_ReturnsNoPartialAllocation()
    {
        var result = GuestRoomAllocator.Allocate(Rules, 5, [],
            [Rooms(10, 1, 2), Rooms(20, 1, 2)]);

        Assert.False(result.IsValid);
        Assert.Equal(GuestRoomAllocationFailure.InsufficientCapacity, result.Failure);
        Assert.Empty(result.Rooms);
    }

    [Fact]
    public void SameInputs_ProduceSameRoomByRoomAllocation()
    {
        var selections = new[] { Rooms(10, 2, 2, 1), Rooms(20, 1, 1, 2) };
        var first = GuestRoomAllocator.Allocate(Rules, 3, [4, 9, 13], selections);
        var second = GuestRoomAllocator.Allocate(Rules, 3, [4, 9, 13], selections);

        Assert.True(first.IsValid);
        Assert.Equal(first.Rooms.Select(room => (room.SelectedRoomIndex, room.RoomTypeId,
            room.Adults, Ages: string.Join(',', room.ChildAges))),
            second.Rooms.Select(room => (room.SelectedRoomIndex, room.RoomTypeId,
                room.Adults, Ages: string.Join(',', room.ChildAges))));
    }

    [Theory]
    [InlineData(-1, 4)]
    [InlineData(1, -1)]
    [InlineData(1, 18)]
    public void InvalidGuestInput_IsExplicit(int adults, int childAge)
    {
        var result = GuestRoomAllocator.Allocate(Rules, adults, [childAge], [Rooms(10, 1, 2, 1)]);

        Assert.False(result.IsValid);
        Assert.Equal(GuestRoomAllocationFailure.InvalidInput, result.Failure);
        Assert.Empty(result.Rooms);
    }
}
