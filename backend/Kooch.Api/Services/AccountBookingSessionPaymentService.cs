using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AccountBookingSessionPaymentService(
    KoochDbContext dbContext,
    IPaymentService paymentService,
    IEnumerable<IPaymentProvider> paymentProviders) : IAccountBookingSessionPaymentService
{
    public async Task<AccountBookingSessionPaymentInitiationResponse> InitiateAsync(
        int userId,
        string sessionCode,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
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

        var sessionId = await dbContext.BookingSessions.AsNoTracking()
            .Where(session =>
                session.ClientId == userId &&
                session.SessionCode == normalizedSessionCode)
            .Select(session => (int?)session.Id)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Booking session not found.");
        var provider = paymentProviders.SingleOrDefault()
            ?? throw new InvalidOperationException("No checkout payment provider is available.");
        var result = await paymentService.InitiateBookingSessionPaymentAsync(
            new BookingSessionPaymentInitiationRequest
            {
                BookingSessionId = sessionId,
                Provider = provider.Name,
                IdempotencyKey = idempotencyKey
            },
            cancellationToken);

        return new AccountBookingSessionPaymentInitiationResponse
        {
            PaymentId = result.PaymentId,
            Status = result.Status,
            Amount = result.Amount,
            Currency = result.Currency,
            CheckoutDestination = provider.Name == InternalTestPaymentProvider.ProviderName
                ? $"/booking/sessions/{Uri.EscapeDataString(normalizedSessionCode)}/mock-payment"
                : string.Empty,
            IsReplay = result.IsReplay
        };
    }
}
