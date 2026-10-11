using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IEffectiveAvailabilityService
{
    Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(
        IReadOnlyCollection<int> roomTypeIds,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int? excludedReservationId = null,
        CancellationToken cancellationToken = default);
}

public sealed class EffectiveRoomTypeAvailability
{
    public int RoomTypeId { get; init; }
    public IReadOnlyDictionary<DateOnly, EffectiveAvailabilityNight> Nights { get; init; } =
        new Dictionary<DateOnly, EffectiveAvailabilityNight>();
    public IReadOnlySet<int> ClaimedRoomIds { get; init; } = new HashSet<int>();

    public bool HasCapacityForFullRange(int roomCount) =>
        Nights.Count > 0 && Nights.Values.All(night => night.HasCapacity(roomCount));
}

public sealed class EffectiveAvailabilityNight
{
    public DateOnly Date { get; init; }
    public int ConfiguredCapacity { get; init; }
    public int ClaimedCapacity { get; init; }
    public int RemainingCapacity { get; init; }
    public AvailabilityStatus ConfiguredStatus { get; init; }
    public AvailabilityStatus EffectiveStatus { get; init; }
    public bool IsClosed { get; init; }

    public bool HasCapacity(int roomCount) =>
        !IsClosed &&
        ConfiguredStatus is AvailabilityStatus.Available or AvailabilityStatus.OnRequest &&
        RemainingCapacity >= roomCount;
}
