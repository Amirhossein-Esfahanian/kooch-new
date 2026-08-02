using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Kooch.Api.Services;

internal sealed class InternalTestPaymentProvider(string signingSecret) : IPaymentProvider
{
    internal const string ProviderName = "internal-test";
    internal const string SignatureHeaderName = "X-Kooch-Test-Signature";

    public string Name => ProviderName;
    public string CallbackRateLimitPolicyName => "payment-callback-internal-test";

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
        var expectedSignature = CreateSignature(context.Body, signingSecret);
        if (!SignaturesMatch(suppliedSignature, expectedSignature))
        {
            throw new PaymentProviderValidationException("The payment callback signature is invalid.");
        }

        InternalTestPaymentCallbackPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<InternalTestPaymentCallbackPayload>(context.Body);
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

    internal static string SerializePayload(InternalTestPaymentCallbackPayload payload) =>
        JsonSerializer.Serialize(payload);

    internal static string CreateSignature(string body, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body)));
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
