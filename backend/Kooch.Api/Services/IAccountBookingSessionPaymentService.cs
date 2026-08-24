using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAccountBookingSessionPaymentService
{
    IReadOnlyList<AccountPaymentProviderOptionResponse> GetSelectableProviders();

    Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(
        int userId,
        string sessionCode,
        string providerKey,
        string idempotencyKey,
        CancellationToken cancellationToken = default);
}
