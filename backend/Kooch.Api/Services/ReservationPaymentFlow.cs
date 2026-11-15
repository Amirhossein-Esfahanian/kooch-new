using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public static class ReservationPaymentFlow
{
    // Source is persisted on each reservation; the actor and the presence of an order
    // are not sufficient to decide who owns its payment/approval lifecycle.
    public static bool RequiresSessionPayment(Reservation reservation) =>
        reservation.BookingSessionId.HasValue && reservation.Source != ReservationSource.AdminCreated;

    public static void EnsureOnlineOrder(IEnumerable<Reservation> reservations)
    {
        if (reservations.Any(reservation => reservation.Source == ReservationSource.AdminCreated))
            throw new InvalidOperationException("Manual orders must use individual reservation payments.");
    }
}
