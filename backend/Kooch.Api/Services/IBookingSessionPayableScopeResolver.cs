using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal interface IBookingSessionPayableScopeResolver
{
    BookingSessionPayableScope Resolve(
        string sessionCurrency,
        IReadOnlyList<BookingSessionPayableChild> children,
        DateTime utcNow);
}

internal sealed record BookingSessionPayableChild(
    int ReservationId,
    ReservationStatus Status,
    decimal FinalAmount,
    string Currency,
    DateTime? PaymentExpiresAtUtc);

internal sealed record BookingSessionPayableScope(
    IReadOnlyList<BookingSessionPayableChild> AllChildren,
    IReadOnlyList<BookingSessionPayableChild> PayableChildren,
    IReadOnlyList<BookingSessionPayableChild> RejectedChildren,
    IReadOnlyList<BookingSessionPayableChild> PendingApprovalChildren,
    IReadOnlyList<BookingSessionPayableChild> UnsupportedChildren,
    bool IsApprovalPhaseClosed,
    bool CanContinueWithApprovedReservations,
    string? Currency,
    decimal PayableAmount,
    DateTime? EarliestPayableDeadlineUtc);
