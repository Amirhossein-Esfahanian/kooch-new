using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public sealed class PublicRoomTypeCalendarResponse
{
    public int RoomTypeId { get; init; }
    public DateOnly From { get; init; }
    public DateOnly To { get; init; }
    public IReadOnlyList<PublicRoomTypeCalendarDayResponse> Days { get; init; } = [];
}

public sealed class PublicRoomTypeCalendarDayResponse
{
    public DateOnly Date { get; init; }
    public decimal? StandardPrice { get; init; }
    public int AvailableUnits { get; init; }
    public AvailabilityStatus AvailabilityStatus { get; init; }
}
