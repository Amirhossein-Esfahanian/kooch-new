using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PaymentFinancializationService(
    KoochDbContext dbContext,
    ICommissionPolicyResolver commissionPolicyResolver) : IPaymentFinancializationService
{
    public Task ApplyAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        decimal grossAmount,
        DateTime calculatedAtUtc,
        CancellationToken cancellationToken = default)
        => ApplyCoreAsync(reservation, payment, paymentItem, grossAmount, 0, null, calculatedAtUtc, cancellationToken);

    public Task ApplyFundingAsync(Reservation reservation, Payment? payment, PaymentItem? paymentItem,
        decimal grossAmount, decimal walletAmount, int fundingAttemptId, DateTime calculatedAtUtc,
        CancellationToken cancellationToken = default) =>
        ApplyCoreAsync(reservation, payment, paymentItem, grossAmount, walletAmount, fundingAttemptId, calculatedAtUtc, cancellationToken);

    private async Task ApplyCoreAsync(Reservation reservation, Payment? payment, PaymentItem? paymentItem,
        decimal grossAmount, decimal walletAmount, int? fundingAttemptId, DateTime calculatedAtUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reservation);
        if (!fundingAttemptId.HasValue)
        {
            ArgumentNullException.ThrowIfNull(payment);
            ValidateSource(reservation, payment, paymentItem, grossAmount);
        }
        else
        {
            var plan = await dbContext.BookingFundingItems.AsNoTracking()
                .Include(i => i.BookingFundingAttempt).ThenInclude(a => a.WalletHold)
                .SingleAsync(i => i.BookingFundingAttemptId == fundingAttemptId && i.ReservationId == reservation.Id, cancellationToken);
            if (plan.GuestPayable != grossAmount || plan.WalletAmount != walletAmount ||
                plan.BookingFundingAttempt.PaymentId != payment?.Id ||
                plan.BookingFundingAttempt.WalletHold.Status != WalletHoldStatus.Consumed ||
                grossAmount != reservation.FinalAmount ||
                grossAmount - walletAmount != (paymentItem?.AllocatedAmount ?? 0) ||
                (paymentItem is not null && (paymentItem.PaymentId != payment?.Id || paymentItem.ReservationId != reservation.Id)))
                throw new InvalidOperationException("Financial recognition must match the consumed checkout funding plan.");
        }

        var currency = (paymentItem?.Currency ?? payment?.Currency ?? reservation.Currency).Trim();
        var correlationKey = payment is not null ? $"payment:{payment.Id}:reservation:{reservation.Id}"
            : $"wallet-funding:{fundingAttemptId}:reservation:{reservation.Id}";
        var paymentId = payment?.Id;
        var existingSnapshot = await dbContext.ReservationFinancialSnapshots
            .SingleOrDefaultAsync(snapshot =>
                    snapshot.PaymentId == paymentId &&
                    snapshot.ReservationId == reservation.Id,
                cancellationToken);
        var existingEntry = await dbContext.FinancialEntries
            .SingleOrDefaultAsync(entry =>
                    entry.EntryType == FinancialEntryType.PropertyPayable &&
                    entry.CorrelationKey == correlationKey,
                cancellationToken);

        if (existingSnapshot is not null || existingEntry is not null)
        {
            EnsureExistingRecognitionIsConsistent(
                existingSnapshot,
                existingEntry,
                reservation,
                payment,
                paymentItem,
                grossAmount,
                currency);
            if (existingSnapshot!.WalletFundingAmount != walletAmount || existingSnapshot.BookingFundingAttemptId != fundingAttemptId)
                throw new InvalidOperationException("Existing reservation funding differs from the checkout plan.");
            return;
        }

        var calculation = await commissionPolicyResolver.ResolveAsync(
            reservation,
            grossAmount,
            cancellationToken);

        var snapshot = new ReservationFinancialSnapshot
        {
            ReservationId = reservation.Id,
            PropertyId = reservation.PropertyId,
            PaymentId = paymentId,
            BookingFundingAttemptId = fundingAttemptId,
            WalletFundingAmount = walletAmount,
            PaymentItemId = paymentItem?.Id,
            GrossAmount = calculation.GrossAmount,
            Currency = currency,
            CommissionType = calculation.CommissionType,
            CommissionRateSource = calculation.CommissionRateSource,
            CommissionRate = calculation.CommissionRate,
            CommissionBase = calculation.CommissionBase,
            CommissionAmount = calculation.CommissionAmount,
            PropertyPayableAmount = calculation.PropertyPayableAmount,
            CalculatedAtUtc = calculatedAtUtc,
            CommissionPolicySource = calculation.CommissionPolicySource,
            CommissionPolicyVersion = calculation.CommissionPolicyVersion
        };
        var payableEntry = new FinancialEntry
        {
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            PaymentId = paymentId,
            PaymentItemId = paymentItem?.Id,
            EntryType = FinancialEntryType.PropertyPayable,
            Amount = calculation.PropertyPayableAmount,
            Currency = currency,
            EffectiveAtUtc = calculatedAtUtc,
            PayableDueDate = await SettlementPolicy.CalculateDueDateAsync(dbContext, reservation, cancellationToken),
            CorrelationKey = correlationKey,
            Reason = "Initial property payable recognition for confirmed reservation."
        };

        dbContext.ReservationFinancialSnapshots.Add(snapshot);
        dbContext.FinancialEntries.Add(payableEntry);
    }

    private static void ValidateSource(
        Reservation reservation,
        Payment? payment,
        PaymentItem? paymentItem,
        decimal grossAmount)
    {
        if (payment is null || payment.Id <= 0)
        {
            throw new InvalidOperationException("Payment must be persisted before financial recognition.");
        }

        if (grossAmount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(grossAmount), "Gross amount cannot be negative.");
        }

        if (paymentItem is null)
        {
            if (payment.ReservationId != reservation.Id || payment.BookingSessionId.HasValue)
            {
                throw new InvalidOperationException("Direct payment does not match the reservation.");
            }

            if (grossAmount != payment.Amount)
            {
                throw new InvalidOperationException("Direct payment gross amount must equal Payment.Amount.");
            }
        }
        else
        {
            if (paymentItem.Id <= 0 ||
                paymentItem.PaymentId != payment.Id ||
                paymentItem.ReservationId != reservation.Id)
            {
                throw new InvalidOperationException("Payment allocation does not match the payment and reservation.");
            }

            if (grossAmount != paymentItem.AllocatedAmount)
            {
                throw new InvalidOperationException(
                    "Booking session gross amount must equal PaymentItem.AllocatedAmount.");
            }
        }

        var currency = paymentItem?.Currency ?? payment.Currency;
        if (string.IsNullOrWhiteSpace(currency) || currency.Trim().Length != 3)
        {
            throw new InvalidOperationException("Financial recognition currency is invalid.");
        }
    }

    private static void EnsureExistingRecognitionIsConsistent(
        ReservationFinancialSnapshot? snapshot,
        FinancialEntry? entry,
        Reservation reservation,
        Payment? payment,
        PaymentItem? paymentItem,
        decimal grossAmount,
        string currency)
    {
        if (snapshot is null || entry is null ||
            snapshot.PropertyId != reservation.PropertyId ||
            snapshot.PaymentItemId != paymentItem?.Id ||
            snapshot.GrossAmount != grossAmount ||
            snapshot.CommissionType != reservation.CommissionType ||
            snapshot.CommissionBase != grossAmount ||
            snapshot.GrossAmount != snapshot.CommissionAmount + snapshot.PropertyPayableAmount ||
            !CurrencyEquals(snapshot.Currency, currency) ||
            entry.PropertyId != reservation.PropertyId ||
            entry.ReservationId != reservation.Id ||
            entry.PaymentId != payment?.Id ||
            entry.PaymentItemId != paymentItem?.Id ||
            entry.Amount != snapshot.PropertyPayableAmount ||
            !CurrencyEquals(entry.Currency, currency))
        {
            throw new InvalidOperationException(
                "Existing payment financial recognition is incomplete or inconsistent.");
        }
    }

    private static bool CurrencyEquals(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
}
