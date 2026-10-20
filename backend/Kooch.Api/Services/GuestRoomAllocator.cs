namespace Kooch.Api.Services;

public sealed record GuestRoomTypeSelection(
    int RoomTypeId,
    RoomTypeOccupancyCapacity Capacity,
    int Quantity);

public sealed record RoomGuestAllocation(
    int SelectedRoomIndex,
    int RoomTypeId,
    int Adults,
    IReadOnlyList<int> ChildAges);

public enum GuestRoomAllocationFailure
{
    InvalidInput,
    InsufficientCapacity
}

public sealed record GuestRoomAllocationResult(
    IReadOnlyList<RoomGuestAllocation> Rooms,
    GuestRoomAllocationFailure? Failure)
{
    public bool IsValid => Failure is null;
}

/// <summary>Pure allocation of stay-level guests to selected room units; it does not price or reserve rooms.</summary>
public static class GuestRoomAllocator
{
    public static GuestRoomAllocationResult Allocate(
        ChildOccupancyRules rules,
        int totalAdults,
        IReadOnlyList<int> childAges,
        IReadOnlyList<GuestRoomTypeSelection> selections)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(childAges);
        ArgumentNullException.ThrowIfNull(selections);

        if (totalAdults < 0 || childAges.Any(age => age is < 0 or > 17) ||
            selections.Count == 0 || selections.Any(selection =>
                selection is null || selection.RoomTypeId <= 0 || selection.Quantity <= 0 ||
                selection.Capacity is null))
            return Invalid(GuestRoomAllocationFailure.InvalidInput);

        var rooms = new List<RoomSlot>();
        foreach (var selection in selections)
        {
            if (!ChildOccupancyEvaluator.Evaluate(rules, selection.Capacity, 0, [], 1).IsEligible)
                return Invalid(GuestRoomAllocationFailure.InvalidInput);

            for (var index = 0; index < selection.Quantity; index++)
                rooms.Add(new RoomSlot(rooms.Count, selection.RoomTypeId, selection.Capacity));
        }

        var nextRoom = 0;
        for (var index = 0; index < totalAdults; index++)
        {
            if (!TryPlace(rooms, rules, ref nextRoom, null))
                return Invalid(GuestRoomAllocationFailure.InsufficientCapacity);
        }

        foreach (var age in childAges)
        {
            if (!TryPlace(rooms, rules, ref nextRoom, age))
                return Invalid(GuestRoomAllocationFailure.InsufficientCapacity);
        }

        return new(rooms.Select(room => new RoomGuestAllocation(
            room.Index, room.RoomTypeId, room.Adults, room.ChildAges.ToArray())).ToArray(), null);
    }

    private static bool TryPlace(
        IReadOnlyList<RoomSlot> rooms,
        ChildOccupancyRules rules,
        ref int nextRoom,
        int? childAge)
    {
        for (var offset = 0; offset < rooms.Count; offset++)
        {
            var index = (nextRoom + offset) % rooms.Count;
            var room = rooms[index];
            if (childAge.HasValue) room.ChildAges.Add(childAge.Value);
            else room.Adults++;

            if (ChildOccupancyEvaluator.Evaluate(
                rules, room.Capacity, room.Adults, room.ChildAges, 1).IsEligible)
            {
                nextRoom = (index + 1) % rooms.Count;
                return true;
            }

            if (childAge.HasValue) room.ChildAges.RemoveAt(room.ChildAges.Count - 1);
            else room.Adults--;
        }

        return false;
    }

    private static GuestRoomAllocationResult Invalid(GuestRoomAllocationFailure failure) => new([], failure);

    private sealed class RoomSlot(int index, int roomTypeId, RoomTypeOccupancyCapacity capacity)
    {
        public int Index { get; } = index;
        public int RoomTypeId { get; } = roomTypeId;
        public RoomTypeOccupancyCapacity Capacity { get; } = capacity;
        public int Adults { get; set; }
        public List<int> ChildAges { get; } = [];
    }
}
