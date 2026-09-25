using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPaymentFinancializationService
{
    Task ApplyAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        decimal grossAmount,
        DateTime calculatedAtUtc,
        CancellationToken cancellationToken = default);
}
