namespace Kooch.Api.Services;

public sealed class IncompleteDailyPricingException(
    int roomTypeId,
    IReadOnlyList<DateOnly> unavailableDates)
    : InvalidOperationException("Daily pricing is incomplete for the requested stay.")
{
    public int RoomTypeId { get; } = roomTypeId;
    public IReadOnlyList<DateOnly> UnavailableDates { get; } = unavailableDates;
}
