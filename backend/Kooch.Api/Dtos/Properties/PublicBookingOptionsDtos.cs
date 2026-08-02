using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public sealed class PublicBookingOptionsResponse
{
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string PropertySlug { get; set; } = string.Empty;
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; }
    public int Children { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public IReadOnlyList<PublicBookingRoomTypeOption> RoomTypes { get; set; } = [];
}

public sealed class PublicBookingRoomTypeOption
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public int AvailableCount { get; set; }
    public ReservationBookingModeFilter BookingMode { get; set; }
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public bool AllowExtraGuest { get; set; }
    public int MaxExtraGuests { get; set; }
    public int NightsCount { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public IReadOnlyList<PublicBookingRoomOption> Rooms { get; set; } = [];
}

public sealed class PublicBookingRoomOption
{
    public int RoomId { get; set; }
    public string Name { get; set; } = string.Empty;
}
