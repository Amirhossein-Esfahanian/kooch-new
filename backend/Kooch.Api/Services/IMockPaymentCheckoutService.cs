using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

internal interface IMockPaymentCheckoutService
{
    Task<MockPaymentSimulationResponse> SimulateAsync(
        int userId,
        string sessionCode,
        bool succeeded,
        CancellationToken cancellationToken = default);
}
