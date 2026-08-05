using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAccountBookingSessionPaymentService
{
    Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(
        int userId,
        string sessionCode,
        string idempotencyKey,
        CancellationToken cancellationToken = default);
}
