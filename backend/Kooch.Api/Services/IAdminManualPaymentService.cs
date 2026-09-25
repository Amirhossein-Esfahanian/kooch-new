using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAdminManualPaymentService
{
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
