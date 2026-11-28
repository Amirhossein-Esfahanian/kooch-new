using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public partial class ReservationService
{
    private static void RedactGuestInternalPaymentMetadata(ReservationResponse response, Reservation reservation)
    {
        // The shared admin response also carries staff identities and internal timeline
        // notes. Guest payment history must not leak those through the enclosing DTO.
        response.CreatedByUserId = response.ApprovedByUserId = response.CancelledByUserId = response.ChangedByUserId = null;
        response.CreatedBy = response.ApprovedBy = null;
        if (reservation.Source == ReservationSource.AdminCreated) response.Notes = null;
        foreach (var entry in response.Timeline)
        {
            entry.ActorUserId = null;
            entry.Actor = null;
            entry.Note = null;
        }
    }

    private async Task ApplyGuestPaymentSummaryAsync(ReservationResponse response, Reservation reservation,
        int userId, DateTime now, CancellationToken ct)
    {
        // Allocation rows own the per-reservation external share. Never add their parent
        // order amount, or count a legacy direct reference to the same receipt again.
        var allocated = await dbContext.PaymentItems.AsNoTracking()
            .Where(item => item.ReservationId == reservation.Id && item.Payment.Status == PaymentStatus.Successful &&
                (item.Payment.Channel != PaymentChannel.Manual || item.Payment.ManualDetails == null ||
                 item.Payment.ManualDetails.VerificationStatus == ManualPaymentVerificationStatus.Approved))
            .SumAsync(item => (decimal?)item.AllocatedAmount, ct) ?? 0;
        var direct = await dbContext.Payments.AsNoTracking()
            .Where(payment => payment.ReservationId == reservation.Id && !payment.BookingSessionId.HasValue && payment.Status == PaymentStatus.Successful &&
                !payment.Items.Any(item => item.ReservationId == reservation.Id) &&
                (payment.Channel != PaymentChannel.Manual || payment.ManualDetails == null ||
                 payment.ManualDetails.VerificationStatus == ManualPaymentVerificationStatus.Approved))
            .SumAsync(payment => (decimal?)payment.Amount, ct) ?? 0;
        // These immutable snapshots record consumed wallet funding, not a wallet balance
        // or an unconsumed hold. Mixed funding's external share is already counted above.
        var wallet = await dbContext.ReservationFinancialSnapshots.AsNoTracking()
            .Where(snapshot => snapshot.ReservationId == reservation.Id)
            .SumAsync(snapshot => (decimal?)snapshot.WalletFundingAmount, ct) ?? 0;
        response.CurrencyLabel = string.IsNullOrWhiteSpace(response.CurrencyLabel)
            ? await BookingCurrencyLabel.ReadAsync(dbContext, ct) : response.CurrencyLabel;

        var payments = await dbContext.Payments.AsNoTracking().Include(payment => payment.ManualDetails)
            .Include(payment => payment.Items.Where(item => item.ReservationId == reservation.Id))
            .Where(payment => payment.Channel == PaymentChannel.Manual && payment.ManualDetails != null &&
                !payment.ManualDetails.IsDeleted && (payment.ReservationId == reservation.Id && !payment.BookingSessionId.HasValue ||
                    payment.Items.Any(item => item.ReservationId == reservation.Id)))
            .OrderByDescending(payment => payment.CreatedAtUtc).ThenByDescending(payment => payment.Id)
            .ToListAsync(ct);
        var receipts = payments.Select(payment =>
        {
            var details = payment.ManualDetails!;
            var reference = details.ReferenceNumber?.Trim();
            return new GuestManualReceiptResponse
            {
                Amount = payment.Items.Count > 0 ? payment.Items.Sum(item => item.AllocatedAmount) : payment.Amount,
                CurrencyLabel = response.CurrencyLabel!, Method = details.Method,
                // Operator-entered references can contain account identifiers. Expose only a suffix.
                Reference = string.IsNullOrEmpty(reference) ? null : $"…{reference[^Math.Min(4, reference.Length)..]}",
                RegisteredAtUtc = payment.CreatedAtUtc, VerificationStatus = details.VerificationStatus,
                HasActiveReviewProtection = ManualPaymentReviewProtection.Protects(reservation, payment, details, now),
                ReviewProtectionExpiresAtUtc = ManualPaymentReviewProtection.GetProtectionExpiry(reservation, payment, details)
            };
        }).ToArray();
        var paid = direct + allocated + wallet;
        var unpaid = Math.Max(0, reservation.FinalAmount - paid);
        response.PaidAmount = paid;
        response.RemainingAmount = unpaid;
        response.IsPaymentEligible = !ReservationPaymentFlow.RequiresSessionPayment(reservation) &&
            IsPaymentEligible(reservation.Status, reservation.PaymentExpiresAtUtc, unpaid, now);
        var summary = new GuestReservationPaymentSummary
        {
            ConfirmedPaidAmount = paid, UnpaidAmount = unpaid,
            PendingReviewAmount = receipts.Where(receipt => receipt.VerificationStatus == ManualPaymentVerificationStatus.PendingVerification)
                .Sum(receipt => receipt.Amount),
            CollectibleAmount = response.IsPaymentEligible ? unpaid : 0,
            UsesOrderPayment = ReservationPaymentFlow.RequiresSessionPayment(reservation), ManualReceipts = receipts
        };
        response.GuestPaymentSummary = summary;

        if (reservation.BookingSessionId is not { } sessionId) return;
        var session = await dbContext.BookingSessions.AsNoTracking().SingleAsync(row => row.Id == sessionId, ct);
        var members = await dbContext.Reservations.AsNoTracking().ForGuestUser(userId)
            .Where(row => row.BookingSessionId == sessionId)
            .OrderBy(row => row.Id)
            .Select(row => new BookingSessionReservationDetailsResponse
            {
                ReservationId = row.Id, ReservationNumber = row.ReservationNumber ?? string.Empty, RoomTypeName = row.RoomType.Name,
                Status = row.Status, FinalAmount = row.FinalAmount, Currency = row.Currency,
                PaymentExpiresAtUtc = row.PaymentExpiresAtUtc
            }).ToArrayAsync(ct);
        var memberIds = members.Select(row => row.ReservationId).ToArray();
        var includesAll = !await dbContext.Reservations.AsNoTracking()
            .Where(row => row.BookingSessionId == sessionId)
            .AnyAsync(row => !memberIds.Contains(row.Id), ct);
        response.GuestOrder = new GuestReservationOrderSummary
        {
            OrderCode = session.SessionCode, IncludesAllReservations = includesAll,
            Reservations = members.Select(row => new GuestOrderReservationResponse(row.ReservationNumber, row.RoomTypeName, row.Status)).ToArray()
        };
        if (!summary.UsesOrderPayment || session.ClientId != userId || !includesAll ||
            await dbContext.Reservations.AsNoTracking().AnyAsync(row => row.BookingSessionId == sessionId &&
                row.Source == ReservationSource.AdminCreated, ct)) return;
        var orderSummary = BookingSessionQueryService.BuildSummary(members, session.Currency,
            new BookingSessionPayableScopeResolver(), now);
        summary.CanPayOrder = orderSummary.IsPaymentReady || orderSummary.CanContinueWithApprovedReservations;
        if (summary.CanPayOrder && reservation.Status == ReservationStatus.ApprovedAwaitingPayment)
            summary.CollectibleAmount = unpaid;
    }
}
