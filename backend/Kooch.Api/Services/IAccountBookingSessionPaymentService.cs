using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IAccountBookingSessionPaymentService
{
    Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(int userId, string sessionCode,
        string providerKey, string idempotencyKey, decimal walletAmount, CancellationToken cancellationToken = default) =>
        walletAmount == 0 ? InitiateAsync(userId, sessionCode, providerKey, idempotencyKey, cancellationToken)
            : throw new NotSupportedException("Wallet checkout is not supported by this service.");

    IReadOnlyList<AccountPaymentProviderOptionResponse> GetSelectableProviders();

    Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(
        int userId,
        string sessionCode,
        string providerKey,
        string idempotencyKey,
        CancellationToken cancellationToken = default);
}
