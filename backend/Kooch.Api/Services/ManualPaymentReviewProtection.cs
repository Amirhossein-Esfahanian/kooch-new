using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class ManualPaymentReviewProtection
{
    internal static DateTime? GetProtectionExpiry(Reservation reservation, Payment payment, ManualPaymentDetails details) =>
        reservation.PaymentExpiresAtUtc is { } deadline &&
        payment.ReservationId == reservation.Id && !payment.BookingSessionId.HasValue &&
        payment.Channel == PaymentChannel.Manual && payment.Status == PaymentStatus.Pending &&
        !payment.IsDeleted && !details.IsDeleted && details.VerificationStatus == ManualPaymentVerificationStatus.PendingVerification &&
        payment.CreatedAtUtc != default && payment.CreatedAtUtc < deadline
            ? deadline.AddHours(24) : null;

    internal static IQueryable<Payment> PendingReceipts(KoochDbContext context) => context.Payments.Where(payment =>
        payment.ReservationId.HasValue && !payment.BookingSessionId.HasValue && payment.Channel == PaymentChannel.Manual &&
        payment.Status == PaymentStatus.Pending && payment.CreatedAtUtc != default && payment.ManualDetails != null &&
        !payment.ManualDetails.IsDeleted && payment.ManualDetails.VerificationStatus == ManualPaymentVerificationStatus.PendingVerification);

    internal static bool Protects(Reservation reservation, Payment payment, ManualPaymentDetails details, DateTime now) =>
        reservation.Status == ReservationStatus.ApprovedAwaitingPayment &&
        GetProtectionExpiry(reservation, payment, details) is { } expiry && expiry > now;

    internal static Task<bool> HasProtectionAsync(KoochDbContext context, Reservation reservation, DateTime now, CancellationToken ct) =>
        reservation.Status != ReservationStatus.ApprovedAwaitingPayment ||
        reservation.PaymentExpiresAtUtc is not { } deadline || deadline <= now.AddHours(-24)
            ? Task.FromResult(false)
            : PendingReceipts(context).AnyAsync(payment => payment.ReservationId == reservation.Id && payment.CreatedAtUtc < deadline, ct);

    internal sealed record LockTarget(int ReservationId, int RoomTypeId, int? BookingSessionId, ReservationSource Source);

    // Resolve before starting the serializable transaction: a shared reservation lock held
    // while waiting for the session lock would invert the session -> reservation order.
    internal static async Task<LockTarget> ReadTargetAsync(KoochDbContext context, int reservationId, CancellationToken ct) =>
        await context.Reservations.AsNoTracking().Where(row => row.Id == reservationId)
            .Select(row => new LockTarget(row.Id, row.RoomTypeId, row.BookingSessionId, row.Source)).SingleOrDefaultAsync(ct)
        ?? throw new KeyNotFoundException("Reservation not found.");

    // Match funding's session-first boundary, then capacity, receipt and reservation.
    internal static async Task LockAsync(KoochDbContext context, LockTarget target, CancellationToken ct)
    {
        if (target.BookingSessionId is { } sessionId)
        {
            var sessions = context.Database.IsSqlServer()
                ? context.BookingSessions.FromSqlInterpolated($"SELECT * FROM BookingSessions WITH (UPDLOCK, HOLDLOCK) WHERE Id = {sessionId}")
                : context.BookingSessions.Where(row => row.Id == sessionId);
            await sessions.AsNoTracking().SingleAsync(ct);
        }
        if (target.BookingSessionId.HasValue && target.Source != ReservationSource.AdminCreated) return;
        var query = context.Database.IsSqlServer()
            ? context.RoomTypes.FromSqlInterpolated($"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {target.RoomTypeId}")
            : context.RoomTypes.Where(row => row.Id == target.RoomTypeId);
        await query.AsNoTracking().SingleAsync(ct);
    }

    internal static void EnsureTarget(Reservation reservation, LockTarget target)
    {
        if (reservation.Id != target.ReservationId || reservation.RoomTypeId != target.RoomTypeId ||
            reservation.BookingSessionId != target.BookingSessionId || reservation.Source != target.Source)
            throw new InvalidOperationException("اطلاعات رزرو تغییر کرده است؛ اطلاعات را دوباره دریافت کنید.");
    }
}
