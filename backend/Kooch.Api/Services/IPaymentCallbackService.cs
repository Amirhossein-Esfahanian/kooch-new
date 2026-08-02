namespace Kooch.Api.Services;

public interface IPaymentCallbackService
{
    Task<PaymentCallbackResult> ReceiveAsync(
        string providerName,
        PaymentProviderCallbackContext context,
        CancellationToken cancellationToken = default);

    Task<PaymentCallbackResult> RetryApplicationAsync(
        int paymentId,
        CancellationToken cancellationToken = default);
}

public sealed class PaymentCallbackResult
{
    public int PaymentId { get; set; }
    public int ReceiptId { get; set; }
    public bool IsDuplicate { get; set; }
    public PaymentCallbackApplicationState ApplicationState { get; set; }
    public DateTime? ProviderConfirmedAtUtc { get; set; }
    public DateTime? AppliedAtUtc { get; set; }
    public DateTime? FailedAtUtc { get; set; }
}

public enum PaymentCallbackApplicationState
{
    ProviderRejected,
    Received,
    Deferred,
    Applied,
    Failed
}
