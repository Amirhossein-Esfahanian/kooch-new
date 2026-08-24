using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Authentication;

namespace Kooch.Api.Services;

internal sealed class InternalTestPaymentProvider(string signingSecret) : IPaymentProvider
{
    internal const string ProviderName = "internal-test";
    internal const string SignatureHeaderName = "X-Kooch-Test-Signature";

    public string ProviderKey => ProviderName;
    public string DisplayLabel => "درگاه آزمایشی";
    public bool IsSelectableForAccountCheckout => true;
    public string CallbackRateLimitPolicyName => PaymentCallbackRateLimitPolicy.Name;

    public Task<ValidatedPaymentProviderCallback> ValidateCallbackAsync(
        PaymentProviderCallbackContext context,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(signingSecret))
        {
            throw new InvalidOperationException("The internal test provider requires a signing secret.");
        }

        var suppliedSignature = context.Headers
            .FirstOrDefault(header => string.Equals(
                header.Key,
                SignatureHeaderName,
                StringComparison.OrdinalIgnoreCase))
            .Value;
        var expectedSignature = CreateSignature(context.Body.Span, signingSecret);
        if (!SignaturesMatch(suppliedSignature, expectedSignature))
        {
            throw new PaymentProviderValidationException("The payment callback signature is invalid.");
        }

        InternalTestPaymentCallbackPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<InternalTestPaymentCallbackPayload>(context.Body.Span);
        }
        catch (JsonException)
        {
            throw new PaymentProviderValidationException("The payment callback payload is invalid.");
        }

        if (payload is null || payload.PaymentId <= 0 || payload.Amount <= 0 ||
            string.IsNullOrWhiteSpace(payload.ProviderEventId) ||
            string.IsNullOrWhiteSpace(payload.TransactionReference) ||
            string.IsNullOrWhiteSpace(payload.Currency) || payload.Currency.Trim().Length != 3 ||
            payload.ProviderOccurredAtUtc == default)
        {
            throw new PaymentProviderValidationException("The payment callback payload is incomplete.");
        }

        return Task.FromResult(new ValidatedPaymentProviderCallback(
            payload.PaymentId,
            payload.ProviderEventId.Trim(),
            payload.TransactionReference.Trim(),
            payload.Amount,
            payload.Currency.Trim().ToUpperInvariant(),
            payload.IsSuccessful,
            payload.ProviderOccurredAtUtc.ToUniversalTime()));
    }

    internal static byte[] SerializePayload(InternalTestPaymentCallbackPayload payload) =>
        JsonSerializer.SerializeToUtf8Bytes(payload);

    internal PaymentProviderCallbackContext CreateSignedCallback(
        int paymentId,
        string providerEventId,
        string transactionReference,
        decimal amount,
        string currency,
        bool succeeded,
        DateTime occurredAtUtc)
    {
        var body = SerializePayload(new InternalTestPaymentCallbackPayload
        {
            PaymentId = paymentId,
            ProviderEventId = providerEventId,
            TransactionReference = transactionReference,
            Amount = amount,
            Currency = currency,
            IsSuccessful = succeeded,
            ProviderOccurredAtUtc = occurredAtUtc
        });
        return new PaymentProviderCallbackContext(
            body,
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [SignatureHeaderName] = CreateSignature(body, signingSecret)
            });
    }

    internal static string CreateSignature(ReadOnlySpan<byte> body, string secret)
    {
        return Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body));
    }

    private static bool SignaturesMatch(string? supplied, string expected)
    {
        if (string.IsNullOrWhiteSpace(supplied))
        {
            return false;
        }

        try
        {
            return CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(supplied.Trim()),
                Convert.FromHexString(expected));
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

internal sealed class InternalTestPaymentCallbackPayload
{
    public int PaymentId { get; set; }
    public string ProviderEventId { get; set; } = string.Empty;
    public string TransactionReference { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool IsSuccessful { get; set; }
    public DateTime ProviderOccurredAtUtc { get; set; }
}
