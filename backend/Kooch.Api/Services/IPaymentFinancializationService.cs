using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPaymentFinancializationService
{
    Task ApplyFundingAsync(Reservation reservation, Payment? payment, PaymentItem? paymentItem,
        decimal grossAmount, decimal walletAmount, int fundingAttemptId, DateTime calculatedAtUtc,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Wallet funding recognition is not implemented by this handler.");

    Task ApplyAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        decimal grossAmount,
        DateTime calculatedAtUtc,
        CancellationToken cancellationToken = default);
}
