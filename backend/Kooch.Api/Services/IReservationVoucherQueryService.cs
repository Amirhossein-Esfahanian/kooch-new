using Kooch.Api.Dtos.Reservations;

namespace Kooch.Api.Services;

public interface IReservationVoucherQueryService
{
    Task<OwnerReservationVoucherResponse> GetForAdminAsync(
        int reservationId,
        CancellationToken cancellationToken = default);

    Task<GuestReservationVoucherResponse> GetForGuestAsync(
        int userId,
        string reservationNumber,
        CancellationToken cancellationToken = default);

    Task<OwnerReservationVoucherResponse> GetForPropertyAsync(
        int userId,
        int propertyId,
        int reservationId,
        CancellationToken cancellationToken = default);
}
