using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAdminManualPaymentService
{
    Task<IReadOnlyList<AdminManualPaymentDetailsResponse>> GetByReservationAsync(
        int reservationId,
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
