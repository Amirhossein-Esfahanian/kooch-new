using System.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public partial class ReservationService
{
    public async Task<ReservationResponse> PrepareManualPaymentAsync(int reservationId,
        (int UserId, UserRole Role) currentUser, CancellationToken cancellationToken = default)
    {
        var summary = await dbContext.Reservations.AsNoTracking().Where(row => row.Id == reservationId)
            .Select(row => new { row.PropertyId, row.RoomTypeId }).SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        await EnsureAdminReservationPermissionAsync(currentUser, summary.PropertyId, "bookings.edit", cancellationToken);

        await using var transaction = await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        await LockRoomTypeAsync(summary.RoomTypeId, cancellationToken);
        var reservation = await LoadLockedReservationAsync(reservationId, cancellationToken);
        await dbContext.Entry(reservation).ReloadAsync(cancellationToken);
        if (reservation.PropertyId != summary.PropertyId || reservation.RoomTypeId != summary.RoomTypeId)
            throw new InvalidOperationException("اتاق رزرو تغییر کرده است؛ جزئیات را دوباره دریافت کنید.");
        await EnsureAdminReservationPermissionAsync(currentUser, reservation.PropertyId, "bookings.edit", cancellationToken);
        var blocker = await ManualPaymentPreparationBlockerAsync(reservation, cancellationToken);
        if (blocker is not null) throw new InvalidOperationException(blocker);
        if (reservation.Status is not (ReservationStatus.Pending or ReservationStatus.ApprovedAwaitingPayment))
            throw new InvalidOperationException("فقط رزرو دستی در وضعیت «در انتظار» قابل آماده‌سازی برای پرداخت است.");

        var range = await ValidateApprovalCapacityAsync(reservation, cancellationToken);
        if (!HasAvailablePreparationCapacity(reservation, range))
            throw new InvalidOperationException("آماده‌سازی فقط برای رزرو دستی با تمام شب‌های Available مجاز است؛ رزروهای OnRequest مسیر تأیید خود را دارند.");

        // A retry returns the existing deadline. It never starts another payment window or hold.
        if (reservation.Status == ReservationStatus.Pending)
        {
            await SetReadyForPaymentAsync(reservation, currentUser, null, cancellationToken);
            auditLogService.Add(currentUser.UserId, AuditAction.BookingApproved, nameof(Reservation), reservation.Id,
                reservation.PropertyId, reservation.ReservationNumber, "Manual reservation prepared for later payment.");
            await new ReservationActivityService(dbContext).AppendAsync(reservation.Id, currentUser.UserId,
                "PaymentPrepared", ReservationActivityVisibility.PropertyVisible, "رزرو دستی برای پرداخت آماده شد",
                cancellationToken: cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (!reservation.PaymentExpiresAtUtc.HasValue)
            throw new InvalidOperationException("مهلت پرداخت این رزرو ثبت نشده است؛ وضعیت را بررسی کنید.");

        await transaction.CommitAsync(cancellationToken);
        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        return response;
    }

    public async Task ApplyAdminManualPaymentActionsAsync(ReservationResponse response,
        (int UserId, UserRole Role) currentUser, CancellationToken cancellationToken = default)
    {
        response.CanPrepareManualPayment = false;
        if (response.Source != ReservationSource.AdminCreated || response.Status != ReservationStatus.Pending) return;
        var reservation = await ReservationQuery().AsNoTracking().SingleOrDefaultAsync(row => row.Id == response.Id, cancellationToken);
        if (reservation is null) return;
        if (await HasSuccessfulManualReservationPaymentAsync(reservation.Id, cancellationToken)) return;

        // The global matrix is unchanged; do not advertise its payment-gated Confirmed shortcut here.
        response.AllowedStatusTransitions = response.AllowedStatusTransitions.Where(status => status != ReservationStatus.Confirmed).ToArray();
        if (currentUser.Role is not (UserRole.SuperAdmin or UserRole.AdminAssistant) ||
            !await permissionService.CanAsync(currentUser.UserId, reservation.PropertyId, "bookings.edit", cancellationToken) ||
            await ManualPaymentPreparationBlockerAsync(reservation, cancellationToken) is not null) return;
        var range = await effectiveAvailabilityService.GetRangeAsync([reservation.RoomTypeId], reservation.CheckInDate,
            reservation.CheckOutDate, reservation.Id, cancellationToken);
        response.CanPrepareManualPayment = range.TryGetValue(reservation.RoomTypeId, out var availability) &&
            HasAvailablePreparationCapacity(reservation, availability);
    }

    private async Task<string?> ManualPaymentPreparationBlockerAsync(Reservation reservation, CancellationToken ct)
    {
        if (reservation.Source != ReservationSource.AdminCreated)
            return "این اقدام فقط برای رزرو دستی مدیر مجاز است؛ رزرو آنلاین باید مسیر خود را طی کند.";
        if (reservation.PaidAtUtc.HasValue || await HasSuccessfulManualReservationPaymentAsync(reservation.Id, ct))
            return "برای این رزرو وجه موفق ثبت شده است؛ آماده‌سازی مجدد مجاز نیست.";
        if (reservation.FinalAmount <= 0 || reservation.CheckInDate >= reservation.CheckOutDate)
            return "مبلغ قابل پرداخت یا بازهٔ اقامت رزرو معتبر نیست.";
        if (!reservation.RoomType.IsActive ||
            reservation.RoomType.InventoryMode == InventoryMode.NamedRooms && !reservation.RoomId.HasValue ||
            reservation.RoomId.HasValue && !await dbContext.Rooms.AsNoTracking().AnyAsync(room => room.Id == reservation.RoomId &&
                room.RoomTypeId == reservation.RoomTypeId && room.IsActive, ct))
            return "اتاق رزرو فعال یا واجد شرایط نیست؛ اطلاعات اتاق را بررسی کنید.";
        return null;
    }

    private Task<bool> HasSuccessfulManualReservationPaymentAsync(int id, CancellationToken ct) =>
        dbContext.Payments.IgnoreQueryFilters().AsNoTracking().AnyAsync(payment => payment.Status == PaymentStatus.Successful &&
            (payment.ReservationId == id || payment.Items.Any(item => item.ReservationId == id)), ct);

    private static bool HasAvailablePreparationCapacity(Reservation reservation, EffectiveRoomTypeAvailability range) =>
        range.HasCapacityForFullRange(1) && range.Nights.Values.All(night => !night.IsClosed && night.EffectiveStatus == AvailabilityStatus.Available) &&
        (!reservation.RoomId.HasValue || !range.ClaimedRoomIds.Contains(reservation.RoomId.Value));
}
