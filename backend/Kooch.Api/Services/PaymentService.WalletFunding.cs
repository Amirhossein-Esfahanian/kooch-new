using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public partial class PaymentService
{
    private async Task<BookingSessionPaymentInitiationResult> CreateOrReplayWalletFundingAsync(
        NormalizedPaymentInitiationRequest request, CancellationToken ct)
    {
        // The session lock serializes checkout keys and callbacks across processes. Capacity and
        // reservations follow, then WalletAccount; Wallet never acquires booking/payment locks.
        var session = await LockBookingSessionAsync(request.BookingSessionId, ct);
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{session.Id}|{request.Provider}|{request.WalletAmount.ToString("0.00", CultureInfo.InvariantCulture)}")));
        var prior = await dbContext.BookingFundingAttempts.Include(a => a.Items).Include(a => a.Payment).ThenInclude(p => p!.Items)
            .Include(a => a.WalletHold).SingleOrDefaultAsync(a => a.BookingSessionId == session.Id && a.IdempotencyKey == request.IdempotencyKey, ct);
        if (prior is not null)
        {
            if (prior.RequestHash != requestHash) throw new InvalidOperationException("The checkout key has already been used with different funding.");
            return FundingResult(prior, true);
        }
        if (await GetExistingPaymentAsync(session.Id, request.IdempotencyKey, ct) is not null)
            throw new InvalidOperationException("The checkout key already belongs to a different payment.");
        await EnsureNoOtherPendingPaymentAsync(session.Id, ct);
        var handler = new PaymentDomainApplicationHandler(dbContext, effectiveAvailabilityService, paymentFinancializationService, reservationVoucherService);
        await handler.LockSessionCapacityAsync(session.Id, ct);
        var reservations = await LockSessionReservationsAsync(session.Id, ct);
        var candidate = BuildInitiationCandidate(session, reservations, request.Provider, request.IdempotencyKey, DateTime.UtcNow);
        ValidateNewPaymentReadiness(reservations, candidate, DateTime.UtcNow);
        var payableIds = candidate.Items.Select(i => i.ReservationId).ToHashSet();
        var plan = BookingWalletFunding.Allocate(reservations.Where(r => payableIds.Contains(r.Id)).ToArray(), request.WalletAmount);
        var externalAmount = candidate.Amount - request.WalletAmount;
        if (externalAmount > 0 && string.IsNullOrWhiteSpace(request.Provider))
            throw new ArgumentException("An external payment provider is required for mixed funding.");
        var holdId = await new WalletService(dbContext, TimeProvider.System).CreateHoldAsync(session.ClientId, candidate.Currency,
            request.WalletAmount, DateTime.SpecifyKind(candidate.PaymentDeadlineUtc, DateTimeKind.Utc), ct);
        Payment? payment = null;
        if (externalAmount > 0)
        {
            payment = CreatePendingPayment(session.Id, candidate with
            {
                Amount = externalAmount, RequestHash = requestHash,
                Items = plan.Where(i => i.GuestPayable > i.WalletAmount).Select(i =>
                    new PaymentInitiationAllocation(i.ReservationId, i.GuestPayable - i.WalletAmount, candidate.Currency)).ToArray()
            });
        }
        var attempt = new BookingFundingAttempt
        {
            BookingSessionId = session.Id, WalletHoldId = holdId, Payment = payment,
            Currency = candidate.Currency, IdempotencyKey = request.IdempotencyKey, RequestHash = requestHash,
            Items = plan.ToList()
        };
        dbContext.BookingFundingAttempts.Add(attempt);
        await dbContext.SaveChangesAsync(ct);
        if (payment is null)
        {
            await handler.ApplyWalletOnlyAsync(attempt, ct);
            await dbContext.SaveWithVoucherNumberRetryAsync(ct);
        }
        return FundingResult(attempt, false);
    }

    private static BookingSessionPaymentInitiationResult FundingResult(BookingFundingAttempt attempt, bool replay) => new()
    {
        BookingSessionId = attempt.BookingSessionId, PaymentId = attempt.PaymentId,
        Status = attempt.Payment?.Status, Amount = attempt.Items.Sum(i => i.GuestPayable - i.WalletAmount),
        WalletAmount = attempt.Items.Sum(i => i.WalletAmount), FundingCompleted = attempt.AppliedAtUtc.HasValue,
        Currency = attempt.Currency, IsReplay = replay, RequestHash = attempt.RequestHash,
        Provider = attempt.Payment?.Provider ?? string.Empty, PaymentDeadlineUtc = attempt.WalletHold.ExpiresAtUtc,
        Items = attempt.Payment?.Items.OrderBy(i => i.ReservationId).Select(ToInitiationItemResult).ToArray() ?? []
    };
}
