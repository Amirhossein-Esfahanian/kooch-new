using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal sealed class MockPaymentCheckoutService(
    KoochDbContext dbContext,
    InternalTestPaymentProvider provider,
    IPaymentCallbackService callbackService) : IMockPaymentCheckoutService
{
    public async Task<MockPaymentSimulationResponse> SimulateAsync(
        int userId,
        string sessionCode,
        bool succeeded,
        CancellationToken cancellationToken = default)
    {
        var normalizedSessionCode = sessionCode?.Trim();
        if (userId <= 0 || string.IsNullOrEmpty(normalizedSessionCode))
        {
            throw new ArgumentException("A valid user and session code are required.");
        }

        var payment = await dbContext.Payments.AsNoTracking()
            .Where(candidate =>
                candidate.BookingSession != null &&
                candidate.BookingSession.ClientId == userId &&
                candidate.BookingSession.SessionCode == normalizedSessionCode &&
                candidate.Provider == InternalTestPaymentProvider.ProviderName)
            .OrderByDescending(candidate => candidate.CreatedAtUtc)
            .ThenByDescending(candidate => candidate.Id)
            .Select(candidate => new
            {
                candidate.Id,
                candidate.Amount,
                candidate.Currency
            })
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Mock payment was not found.");
        var callback = provider.CreateSignedCallback(
            payment.Id,
            $"mock-event-{payment.Id}-{(succeeded ? "success" : "failure")}",
            $"mock-transaction-{payment.Id}",
            payment.Amount,
            payment.Currency,
            succeeded,
            DateTime.UtcNow);
        var result = await callbackService.ReceiveAsync(
            provider.ProviderKey,
            callback,
            cancellationToken);
        var applied = result.ApplicationState == PaymentCallbackApplicationState.Applied;

        return new MockPaymentSimulationResponse
        {
            PaymentId = result.PaymentId,
            State = result.ApplicationState switch
            {
                PaymentCallbackApplicationState.Applied => "applied",
                PaymentCallbackApplicationState.ProviderRejected => "failed",
                PaymentCallbackApplicationState.Failed => "pending_reconciliation",
                _ => "received"
            },
            IsDuplicate = result.IsDuplicate,
            RedirectDestination = applied
                ? $"/booking/sessions/{Uri.EscapeDataString(normalizedSessionCode)}/success"
                : $"/booking/sessions/{Uri.EscapeDataString(normalizedSessionCode)}/payment-failure"
        };
    }
}
