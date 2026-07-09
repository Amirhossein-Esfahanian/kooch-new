using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationService
{
    Task<PagedResult<ReservationListItemResponse>> SearchAsync(
        ReservationListQuery query,
        CancellationToken cancellationToken = default);

    Task<PagedResult<ReservationListItemResponse>> SearchByPropertyAsync(
        int propertyId,
        ReservationListQuery query,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> GetByIdAsync(
        int reservationId,
        int? propertyId = null,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> CreateAsync(
        ReservationCreateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> ApproveAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> CancelAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<bool> ExpirePaymentWindowAsync(
        int reservationId,
        CancellationToken cancellationToken = default);
}
