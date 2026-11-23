using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAdminManualPaymentService
{
    Task<Kooch.Api.Dtos.Reservations.PagedResult<ManualPaymentReviewQueueItem>> GetPendingReviewAsync(
        ManualPaymentReviewQueueQuery query, int actorUserId, CancellationToken ct = default);

    Task<ManualOrderBalanceResponse> GetOrderBalanceAsync(int bookingSessionId, int actorUserId,
        CancellationToken cancellationToken = default);
    Task<ManualOrderSettlementResponse> SettleOrderAsync(int bookingSessionId,
        ManualOrderSettlementRequest request, int actorUserId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AdminManualPaymentDetailsResponse>> GetByReservationAsync(
        int reservationId,
        int actorUserId,
        CancellationToken cancellationToken = default);

    Task<AdminManualPaymentResponse> CreateAsync(
        AdminManualPaymentCreateRequest request,
        int actorUserId,
        CancellationToken cancellationToken = default);

    Task<AdminManualPaymentResponse> ApproveAsync(
        int paymentId,
        int actorUserId,
        CancellationToken cancellationToken = default);

    Task<AdminManualPaymentResponse> RejectAsync(
        int paymentId,
        AdminManualPaymentRejectRequest request,
        int actorUserId,
        CancellationToken cancellationToken = default);
}
