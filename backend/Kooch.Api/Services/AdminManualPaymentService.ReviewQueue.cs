using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class AdminManualPaymentService
{
    public async Task<PagedResult<ManualPaymentReviewQueueItem>> GetPendingReviewAsync(
        ManualPaymentReviewQueueQuery query, int actorUserId, CancellationToken ct = default)
    {
        await EnsurePaymentActorAsync(actorUserId, ct);
        if (query.Page is < 1 or > 1_000_000 || query.PageSize is < 1 or > 100 || query.PropertyId is <= 0)
            throw new ArgumentException("صفحه یا اقامتگاه معتبر نیست.");
        var accessibleIds = await propertyAuthorizationService!.GetAccessiblePropertiesAsync(actorUserId, ct);
        if (query.PropertyId is { } propertyId && !accessibleIds.Contains(propertyId))
            throw new UnauthorizedAccessException("به اقامتگاه این صف دسترسی ندارید.");

        // Include overdue and legacy pending receipts for financial follow-up, even when
        // they cannot protect capacity. Never expire reservations from this read endpoint.
        var receipts = dbContext.Payments.AsNoTracking().Where(p =>
            p.ReservationId.HasValue && !p.BookingSessionId.HasValue && p.Channel == PaymentChannel.Manual &&
            p.Status == PaymentStatus.Pending && p.ManualDetails != null && !p.ManualDetails.IsDeleted &&
            p.ManualDetails.VerificationStatus == ManualPaymentVerificationStatus.PendingVerification &&
            accessibleIds.Contains(p.Reservation!.PropertyId) &&
            (!query.PropertyId.HasValue || p.Reservation.PropertyId == query.PropertyId));
        var total = await receipts.CountAsync(ct);
        var now = DateTime.UtcNow;
        var approaching = now.AddHours(1); // Display urgency only; never extends review protection.
        var projected = receipts.Select(p => new
        {
            Payment = p,
            Expiry = p.CreatedAtUtc != default && p.Reservation!.PaymentExpiresAtUtc.HasValue &&
                p.CreatedAtUtc < p.Reservation.PaymentExpiresAtUtc
                ? (DateTime?)p.Reservation.PaymentExpiresAtUtc.Value.AddHours(24) : null
        }).Select(x => new
        {
            x.Payment, x.Expiry,
            Priority = x.Payment.Reservation!.Status != ReservationStatus.ApprovedAwaitingPayment ||
                !x.Expiry.HasValue || x.Expiry <= now ? 0 : x.Expiry <= approaching ? 1 : 2
        });
        var items = await projected.OrderBy(x => x.Priority)
            .ThenBy(x => x.Expiry ?? x.Payment.CreatedAtUtc).ThenBy(x => x.Payment.CreatedAtUtc).ThenBy(x => x.Payment.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(x => new ManualPaymentReviewQueueItem
            {
                PaymentId = x.Payment.Id, ReservationId = x.Payment.ReservationId!.Value,
                ReservationNumber = x.Payment.Reservation!.ReservationNumber ?? string.Empty,
                OrderCode = x.Payment.Reservation.BookingSession == null ? null : x.Payment.Reservation.BookingSession.SessionCode,
                PropertyId = x.Payment.Reservation.PropertyId, PropertyName = x.Payment.Reservation.Property.Name,
                GuestName = x.Payment.Reservation.Guest == null ? string.Empty :
                    (x.Payment.Reservation.Guest.FirstName + " " + x.Payment.Reservation.Guest.LastName).Trim(),
                CurrencyLabel = x.Payment.Reservation.CurrencyLabel,
                Amount = x.Payment.Amount, Currency = x.Payment.Currency, Method = x.Payment.ManualDetails!.Method,
                CreatedAtUtc = x.Payment.CreatedAtUtc, PaymentExpiresAtUtc = x.Payment.Reservation.PaymentExpiresAtUtc,
                ReviewProtectionExpiresAtUtc = x.Expiry, ReservationStatus = x.Payment.Reservation.Status,
                ReviewState = x.Expiry.HasValue && x.Expiry <= now ? "ProtectionExpired" : x.Priority == 0 ? "FinancialFollowUp" :
                    x.Priority == 1 ? "ExpiringSoon" : "Protected"
            }).ToListAsync(ct);
        return new() { Items = items, TotalCount = total, Page = query.Page, PageSize = query.PageSize,
            TotalPages = (int)Math.Ceiling(total / (double)query.PageSize) };
    }
}
