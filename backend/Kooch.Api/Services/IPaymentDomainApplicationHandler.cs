using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPaymentDomainApplicationHandler
{
    Task<PaymentDomainApplicationOutcome> ApplyAsync(
        Payment payment,
        CancellationToken cancellationToken = default);
}

public enum PaymentDomainApplicationOutcome
{
    Deferred,
    Applied
}
