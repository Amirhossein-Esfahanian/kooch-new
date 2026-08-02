using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.BookingSessions;

public sealed class BookingSessionCreateRequest
{
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public string? IdempotencyKey { get; set; }
    public IReadOnlyList<BookingSessionReservationCreateItem> Items { get; set; } = [];
}

public sealed class AccountBookingSessionCreateRequest
{
    public string? IdempotencyKey { get; set; }
    public IReadOnlyList<AccountBookingSessionReservationCreateItem> Items { get; set; } = [];
}

public sealed class AccountBookingSessionReservationCreateItem
{
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; } = 1;
    public int Children { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public string? Notes { get; set; }
}

public sealed class BookingSessionReservationCreateItem
{
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; } = 1;
    public int Children { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public ReservationStatus? Status { get; set; }
    public string? Notes { get; set; }
}

public sealed class BookingSessionCreateResult
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public IReadOnlyList<BookingSessionReservationResult> Reservations { get; set; } = [];
}

public sealed class AccountBookingSessionCreateResponse
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public IReadOnlyList<BookingSessionReservationResult> Reservations { get; set; } = [];
}

public sealed class BookingSessionReservationResult
{
    public int ReservationId { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public ReservationStatus Status { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}
