using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.BookingSessions;

public sealed class BookingSessionDetailsResponse
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public string Currency { get; set; } = string.Empty;
    public BookingSessionPropertyResponse Property { get; set; } = new();
    public BookingSessionClientResponse Client { get; set; } = new();
    public BookingSessionGuestResponse? Guest { get; set; }
    public BookingSessionDerivedSummaryResponse Summary { get; set; } = new();
    public IReadOnlyList<BookingSessionReservationDetailsResponse> Reservations { get; set; } = [];
}

public sealed class BookingSessionPropertyResponse
{
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
}

public sealed class BookingSessionClientResponse
{
    public int ClientId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
}

public sealed class BookingSessionGuestResponse
{
    public int GuestId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Mobile { get; set; }
    public string? Email { get; set; }
}

public sealed class BookingSessionDerivedSummaryResponse
{
    public string DerivedStatus { get; set; } = string.Empty;
    public int ReservationCount { get; set; }
    public decimal TotalAmount { get; set; }
    public DateOnly? EarliestCheckInDate { get; set; }
    public DateOnly? LatestCheckOutDate { get; set; }
    public bool IsPaymentReady { get; set; }
    public bool HasPendingApprovals { get; set; }
    public bool HasRejectedReservations { get; set; }
    public bool HasInconsistentPaymentDeadlines { get; set; }
    public DateTime? EarliestPaymentDeadlineUtc { get; set; }
    public DateTime? EarliestApprovalDeadlineUtc { get; set; }
    public IReadOnlyList<BookingSessionStatusCountResponse> StatusCounts { get; set; } = [];
}

public sealed class BookingSessionStatusCountResponse
{
    public ReservationStatus Status { get; set; }
    public int Count { get; set; }
}

public sealed class BookingSessionReservationDetailsResponse
{
    public int ReservationId { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public int RoomTypeId { get; set; }
    public string RoomTypeName { get; set; } = string.Empty;
    public int? RoomId { get; set; }
    public string? RoomName { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public ReservationStatus Status { get; set; }
    public DateTime? PaymentExpiresAtUtc { get; set; }
    public DateTime? ApprovalExpiresAtUtc { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}

public sealed class AccountBookingSessionResponse
{
    public string SessionCode { get; set; } = string.Empty;
    public string DisplayCodeLabel { get; set; } = "کد سفارش";
    public BookingSessionPropertyResponse Property { get; set; } = new();
    public string Currency { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public BookingSessionDerivedSummaryResponse Summary { get; set; } = new();
    public DateTime? CommonPaymentDeadlineUtc { get; set; }
    public AccountBookingSessionPaymentResponse? Payment { get; set; }
    public IReadOnlyList<AccountBookingSessionReservationResponse> Reservations { get; set; } = [];
}

public sealed class AccountBookingSessionListQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
}

public sealed class AccountBookingSessionListItemResponse
{
    public string SessionCode { get; set; } = string.Empty;
    public BookingSessionPropertyResponse Property { get; set; } = new();
    public DateOnly? CheckInDate { get; set; }
    public DateOnly? CheckOutDate { get; set; }
    public int ReservationCount { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string DerivedStatus { get; set; } = string.Empty;
    public PaymentStatus? PaymentStatus { get; set; }
    public DateTime? PaymentDeadlineUtc { get; set; }
    public bool IsPaymentReady { get; set; }
}

public sealed class AccountBookingSessionPaymentResponse
{
    public int PaymentId { get; set; }
    public PaymentStatus Status { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string? Provider { get; set; }
    public DateTime? AppliedAtUtc { get; set; }
}

public sealed class AccountBookingSessionReservationResponse
{
    public string ReservationNumber { get; set; } = string.Empty;
    public int RoomTypeId { get; set; }
    public string RoomTypeName { get; set; } = string.Empty;
    public int? RoomId { get; set; }
    public string? RoomName { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public ReservationStatus Status { get; set; }
    public DateTime? PaymentExpiresAtUtc { get; set; }
    public DateTime? ApprovalExpiresAtUtc { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}
