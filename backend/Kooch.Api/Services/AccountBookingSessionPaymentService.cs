using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AccountBookingSessionPaymentService : IAccountBookingSessionPaymentService
{
    private const int MaximumProviderKeyLength = 100;
    private readonly KoochDbContext dbContext;
    private readonly IPaymentService paymentService;
    private readonly IReadOnlyDictionary<string, IPaymentProvider> paymentProviders;

    public AccountBookingSessionPaymentService(
        KoochDbContext dbContext,
        IPaymentService paymentService,
        IEnumerable<IPaymentProvider> paymentProviders)
    {
        this.dbContext = dbContext;
        this.paymentService = paymentService;
        this.paymentProviders = BuildProviderIndex(paymentProviders);
    }

    public IReadOnlyList<AccountPaymentProviderOptionResponse> GetSelectableProviders() =>
        paymentProviders.Values
            .Where(provider => provider.IsSelectableForAccountCheckout)
            .OrderBy(provider => provider.ProviderKey, StringComparer.Ordinal)
            .Select(provider => new AccountPaymentProviderOptionResponse
            {
                Value = provider.ProviderKey,
                Label = provider.DisplayLabel
            })
            .ToArray();

    public Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(
        int userId,
        string sessionCode,
        string providerKey,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
        => InitiateAsync(userId, sessionCode, providerKey, idempotencyKey, 0, cancellationToken);

    public async Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(int userId, string sessionCode,
        string providerKey, string idempotencyKey, decimal walletAmount, CancellationToken cancellationToken = default)
    {
        if (userId <= 0)
        {
            throw new UnauthorizedAccessException("The authenticated user is invalid.");
        }

        var normalizedSessionCode = sessionCode?.Trim();
        if (string.IsNullOrEmpty(normalizedSessionCode))
        {
            throw new ArgumentException("Session code is required.", nameof(sessionCode));
        }

        var provider = walletAmount > 0 && string.IsNullOrWhiteSpace(providerKey) ? null : ResolveSelectableProvider(providerKey);
        var sessionId = await dbContext.BookingSessions.AsNoTracking()
            .Where(session =>
                session.ClientId == userId &&
                session.SessionCode == normalizedSessionCode)
            .Select(session => (int?)session.Id)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Booking session not found.");
        var result = await paymentService.InitiateBookingSessionPaymentAsync(
            new BookingSessionPaymentInitiationRequest
            {
                BookingSessionId = sessionId,
                Provider = provider?.ProviderKey ?? string.Empty,
                IdempotencyKey = idempotencyKey,
                WalletAmount = walletAmount
            },
            cancellationToken);

        return new AccountBookingSessionPaymentInitiationResponse
        {
            PaymentId = result.PaymentId,
            Status = result.Status,
            WalletAmount = result.WalletAmount,
            FundingCompleted = result.FundingCompleted,
            Amount = result.Amount,
            Currency = result.Currency,
            CheckoutDestination = result.FundingCompleted
                ? $"/booking/sessions/{Uri.EscapeDataString(normalizedSessionCode)}"
                : provider?.ProviderKey == InternalTestPaymentProvider.ProviderName
                ? $"/booking/sessions/{Uri.EscapeDataString(normalizedSessionCode)}/mock-payment"
                : string.Empty,
            IsReplay = result.IsReplay
        };
    }

    private IPaymentProvider ResolveSelectableProvider(string providerKey)
    {
        var normalizedProviderKey = providerKey?.Trim();
        if (string.IsNullOrEmpty(normalizedProviderKey) ||
            normalizedProviderKey.Length > MaximumProviderKeyLength)
        {
            throw new ArgumentException("Payment provider is required.", nameof(providerKey));
        }

        if (!paymentProviders.TryGetValue(normalizedProviderKey, out var provider) ||
            !provider.IsSelectableForAccountCheckout)
        {
            throw new ArgumentException(
                "The selected payment provider is unavailable.",
                nameof(providerKey));
        }

        return provider;
    }

    private static IReadOnlyDictionary<string, IPaymentProvider> BuildProviderIndex(
        IEnumerable<IPaymentProvider> providers)
    {
        // Keys are exact, case-sensitive API values; case variants are rejected as ambiguous registrations.
        var providerIndex = new Dictionary<string, IPaymentProvider>(StringComparer.Ordinal);
        var unambiguousKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var provider in providers)
        {
            var providerKey = provider.ProviderKey;
            if (string.IsNullOrWhiteSpace(providerKey) ||
                providerKey.Length > MaximumProviderKeyLength ||
                !string.Equals(providerKey, providerKey.Trim(), StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(provider.DisplayLabel))
            {
                throw new InvalidOperationException("Payment provider registration is invalid.");
            }

            if (!unambiguousKeys.Add(providerKey) ||
                !providerIndex.TryAdd(providerKey, provider))
            {
                throw new InvalidOperationException(
                    "Payment provider registrations contain duplicate keys.");
            }
        }

        return providerIndex;
    }
}
