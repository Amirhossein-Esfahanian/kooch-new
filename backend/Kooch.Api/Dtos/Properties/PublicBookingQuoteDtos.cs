using Kooch.Api.Dtos.Reservations;

namespace Kooch.Api.Dtos.Properties;

public sealed class PublicBookingQuoteRequest
{
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public IReadOnlyList<PublicBookingQuoteSelection> Selections { get; set; } = [];
}

public sealed class PublicBookingQuoteSelection
{
    public int RoomTypeId { get; set; }
    public int Quantity { get; set; }
    public int? RatePlanId { get; set; }
}

public sealed class PublicBookingQuoteResponse
{
    public int PropertyId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public IReadOnlyList<PublicBookingQuotedRoom> Rooms { get; set; } = [];
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}

public sealed class PublicBookingQuotedRoom
{
    public int SelectedRoomIndex { get; set; }
    public int RoomTypeId { get; set; }
    public int? RatePlanId { get; set; }
    public int Adults { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public ReservationBookingModeFilter BookingMode { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}
