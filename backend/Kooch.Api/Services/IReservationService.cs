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

    Task<PagedResult<ReservationListItemResponse>> SearchByGuestUserAsync(
        int userId,
        ReservationListQuery query,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> GetByIdForGuestUserAsync(
        int userId,
        int reservationId,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> GetByNumberForGuestUserAsync(
        int userId,
        string reservationNumber,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> CreateAsync(
        ReservationCreateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> UpdateAsync(
        int reservationId,
        ReservationUpdateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> ApproveAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> CancelAsync(
        int reservationId,
        ReservationCancellationRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> AdjustPriceAsync(
        int reservationId,
        ReservationPriceAdjustmentRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationResponse> UpdateStatusAsync(
        int reservationId,
        ReservationStatusUpdateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationPaymentLinkResponse> GeneratePaymentLinkAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<ReservationPaymentLinkResponse> SendPaymentLinkAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default);

    Task<bool> ExpirePaymentWindowAsync(
        int reservationId,
        CancellationToken cancellationToken = default);

    Task<int> ExpireApprovedUnpaidReservationsAsync(
        CancellationToken cancellationToken = default);
}
