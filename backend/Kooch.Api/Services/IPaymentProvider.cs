namespace Kooch.Api.Services;

public interface IPaymentProvider
{
    string ProviderKey { get; }
    string DisplayLabel { get; }
    bool IsSelectableForAccountCheckout { get; }
    string CallbackRateLimitPolicyName { get; }

    Task<ValidatedPaymentProviderCallback> ValidateCallbackAsync(
        PaymentProviderCallbackContext context,
        CancellationToken cancellationToken = default);
}

public sealed record PaymentProviderCallbackContext(
    ReadOnlyMemory<byte> Body,
    IReadOnlyDictionary<string, string> Headers,
    string? RemoteAddress = null);

public sealed record ValidatedPaymentProviderCallback(
    int PaymentId,
    string ProviderEventId,
    string TransactionReference,
    decimal Amount,
    string Currency,
    bool IsSuccessful,
    DateTime ProviderOccurredAtUtc);

public sealed class PaymentProviderValidationException(string message) : Exception(message);
