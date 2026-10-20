using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public sealed class PublicBookingCandidatesResponse
{
    public int PropertyId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Rooms { get; set; }
    public int Adults { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public bool RequiresBookingQuote => true;
    public IReadOnlyList<PublicBookingRoomTypeCandidate> RoomTypes { get; set; } = [];
}

public sealed class PublicBookingRoomTypeCandidate
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public RoomKind RoomKind { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public int AvailableCount { get; set; }
    public ReservationBookingModeFilter BookingMode { get; set; }
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public bool AllowExtraGuest { get; set; }
    public int MaxExtraGuests { get; set; }
    public string? DefaultMealPlanName { get; set; }
    public string? DefaultMealPlanSlug { get; set; }
    public IReadOnlyList<PublicBookingRoomOption> Rooms { get; set; } = [];
    public IReadOnlyList<PublicBookingRatePlanCandidate> RatePlans { get; set; } = [];
}

public sealed class PublicBookingRatePlanCandidate
{
    public int RatePlanId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? MealPlanName { get; set; }
    public string? MealPlanSlug { get; set; }
    public int? MinimumNights { get; set; }
}
