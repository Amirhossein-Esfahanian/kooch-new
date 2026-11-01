namespace Kooch.Api.Dtos.Availability;

// Reservation-unit capacity of active RoomTypes, not physical rooms or guaranteed sellability.
public sealed class OwnerPropertyDailyInventorySummaryResponse
{
    public int PropertyId { get; init; }
    public DateOnly BusinessDate { get; init; }
    public long ConfiguredUnits { get; init; }
    public long EligibleConfiguredUnits { get; init; }
    public long ReservedAllocatedUnits { get; init; }
    public long RemainingUnits { get; init; }
    public long AvailableModeRemainingUnits { get; init; }
    public long OnRequestRemainingUnits { get; init; }
    public int BlockedRoomTypeCount { get; init; }
}
