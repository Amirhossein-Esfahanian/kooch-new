using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal static class GuestReservationOwnership
{
    internal static IQueryable<Reservation> ForGuestUser(this IQueryable<Reservation> reservations, int userId) =>
        reservations.Where(reservation => reservation.Guest != null && reservation.Guest.UserId == userId);
}
