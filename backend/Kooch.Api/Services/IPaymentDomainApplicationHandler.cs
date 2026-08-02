using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPaymentDomainApplicationHandler
{
    Task<PaymentDomainApplicationOutcome> ApplyAsync(
        Payment payment,
        IReadOnlyList<Reservation> reservations,
        CancellationToken cancellationToken = default);
}

public enum PaymentDomainApplicationOutcome
{
    Deferred,
    Applied
}

public sealed class DeferredPaymentDomainApplicationHandler : IPaymentDomainApplicationHandler
{
    public Task<PaymentDomainApplicationOutcome> ApplyAsync(
        Payment payment,
        IReadOnlyList<Reservation> reservations,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(PaymentDomainApplicationOutcome.Deferred);
}
