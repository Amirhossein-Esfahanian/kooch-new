using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface IReservationNotificationDispatcher
{
    Task NotifyPendingApprovalAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken = default);

    Task NotifyOwnerApprovalTimeoutAsync(
        int reservationId,
        CancellationToken cancellationToken = default);

    Task<bool> NotifyApprovalReminderAsync(
        int reservationId,
        DateTime nowUtc,
        string occurrenceKey,
        CancellationToken cancellationToken = default);
}

public sealed class ReservationNotificationDispatcher(
    KoochDbContext dbContext,
    INotificationService notificationService,
    IReservationNotificationRecipientResolver recipientResolver)
    : IReservationNotificationDispatcher
{
    public async Task NotifyPendingApprovalAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken = default)
    {
        var reservations = await LoadAsync(reservationIds, cancellationToken);
        foreach (var propertyGroup in reservations.GroupBy(reservation => reservation.PropertyId))
        {
            var recipients = await recipientResolver.ResolveAsync(
                propertyGroup.Key,
                cancellationToken);
            foreach (var reservation in propertyGroup)
            {
                await notificationService.SendAsync(
                    CreateGuestRequest(reservation, isTimeout: false),
                    cancellationToken);
                foreach (var recipient in recipients)
                {
                    await notificationService.SendAsync(
                        CreateStaffRequest(reservation, recipient, isTimeout: false),
                        cancellationToken);
                }
            }
        }
    }

    public async Task NotifyOwnerApprovalTimeoutAsync(
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        var reservation = AssertSingle(await LoadAsync([reservationId], cancellationToken));
        var recipients = await recipientResolver.ResolveAsync(
            reservation.PropertyId,
            cancellationToken);
        await notificationService.SendAsync(
            CreateGuestRequest(reservation, isTimeout: true),
            cancellationToken);
        foreach (var recipient in recipients)
        {
            await notificationService.SendAsync(
                CreateStaffRequest(reservation, recipient, isTimeout: true),
                cancellationToken);
        }
    }

    public async Task<bool> NotifyApprovalReminderAsync(
        int reservationId,
        DateTime nowUtc,
        string occurrenceKey,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations.AsNoTracking()
            .Where(item =>
                item.Id == reservationId &&
                item.Status == ReservationStatus.PendingApproval &&
                item.ApprovalExpiresAtUtc.HasValue &&
                item.ApprovalExpiresAtUtc.Value > nowUtc)
            .Select(item => new ReservationNotificationSnapshot(
                item.Id,
                item.ReservationNumber ?? string.Empty,
                item.ClientId,
                item.GuestId,
                item.Client.PhoneNumber,
                item.Client.Email,
                item.PropertyId,
                item.Property.Name,
                item.CheckInDate,
                item.CheckOutDate,
                item.ApprovalExpiresAtUtc,
                item.BookingSession == null ? null : item.BookingSession.SessionCode))
            .SingleOrDefaultAsync(cancellationToken);
        if (reservation is null)
        {
            return false;
        }

        var recipients = await recipientResolver.ResolveAsync(
            reservation.PropertyId,
            cancellationToken);
        foreach (var recipient in recipients)
        {
            await notificationService.SendAsync(
                CreateReminderRequest(reservation, recipient, occurrenceKey),
                cancellationToken);
        }

        return recipients.Count > 0;
    }

    private async Task<List<ReservationNotificationSnapshot>> LoadAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken) =>
        await dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservationIds.Contains(reservation.Id))
            .OrderBy(reservation => reservation.Id)
            .Select(reservation => new ReservationNotificationSnapshot(
                reservation.Id,
                reservation.ReservationNumber ?? string.Empty,
                reservation.ClientId,
                reservation.GuestId,
                reservation.Client.PhoneNumber,
                reservation.Client.Email,
                reservation.PropertyId,
                reservation.Property.Name,
                reservation.CheckInDate,
                reservation.CheckOutDate,
                reservation.ApprovalExpiresAtUtc,
                reservation.BookingSession == null ? null : reservation.BookingSession.SessionCode))
            .ToListAsync(cancellationToken);

    private static ReservationNotificationSnapshot AssertSingle(
        IReadOnlyList<ReservationNotificationSnapshot> reservations) =>
        reservations.Count == 1
            ? reservations[0]
            : throw new KeyNotFoundException("Reservation not found.");

    private static NotificationRequest CreateGuestRequest(
        ReservationNotificationSnapshot reservation,
        bool isTimeout)
    {
        var eventType = isTimeout
            ? NotificationEventType.ReservationOwnerApprovalTimedOut
            : NotificationEventType.ReservationPendingApproval;
        var link = reservation.SessionCode is null
            ? $"/account/reservations/{reservation.ReservationNumber}"
            : $"/account/booking-sessions/{reservation.SessionCode}";
        return new NotificationRequest
        {
            EventType = eventType,
            RecipientUserId = reservation.ClientId,
            RecipientGuestId = reservation.GuestId,
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            Mobile = reservation.ClientMobile,
            Email = reservation.ClientEmail,
            Subject = reservation.ReservationNumber,
            Message = isTimeout
                ? "مهلت پاسخ اقامتگاه به پایان رسید و درخواست رزرو تأیید نشد."
                : "درخواست رزرو شما برای اقامتگاه ارسال شد و در انتظار تأیید است.",
            DataJson = CreateData(
                reservation,
                link,
                isTimeout ? ReservationRejectionReasons.OwnerApprovalTimeout : null),
            DedupeKey = $"reservation:{reservation.Id}:{eventType}:guest:{reservation.ClientId}",
            Channels = ResolveChannels(reservation.ClientMobile, reservation.ClientEmail)
        };
    }

    private static NotificationRequest CreateStaffRequest(
        ReservationNotificationSnapshot reservation,
        ReservationNotificationRecipient recipient,
        bool isTimeout)
    {
        var eventType = isTimeout
            ? NotificationEventType.ReservationOwnerApprovalTimedOut
            : NotificationEventType.ReservationApprovalRequested;
        var link = recipient.IsPlatformFollowUp
            ? $"/admin/reservations?reservationNumber={Uri.EscapeDataString(reservation.ReservationNumber)}"
            : $"/owner/properties/{reservation.PropertyId}/reservations?reservationId={reservation.Id}";
        return new NotificationRequest
        {
            EventType = eventType,
            RecipientUserId = recipient.UserId,
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            Mobile = recipient.Mobile,
            Email = recipient.Email,
            Subject = reservation.ReservationNumber,
            Message = isTimeout
                ? "مهلت بررسی درخواست رزرو به پایان رسید و درخواست بسته شد."
                : "درخواست رزرو جدید نیازمند بررسی است.",
            DataJson = CreateData(
                reservation,
                link,
                isTimeout ? ReservationRejectionReasons.OwnerApprovalTimeout : null),
            DedupeKey = $"reservation:{reservation.Id}:{eventType}:user:{recipient.UserId}",
            Channels = ResolveChannels(recipient.Mobile, recipient.Email)
        };
    }

    private static NotificationRequest CreateReminderRequest(
        ReservationNotificationSnapshot reservation,
        ReservationNotificationRecipient recipient,
        string occurrenceKey)
    {
        var link = recipient.IsPlatformFollowUp
            ? $"/admin/reservations?reservationNumber={Uri.EscapeDataString(reservation.ReservationNumber)}"
            : $"/owner/properties/{reservation.PropertyId}/reservations?reservationId={reservation.Id}";
        return new NotificationRequest
        {
            EventType = NotificationEventType.ReservationApprovalReminder,
            RecipientUserId = recipient.UserId,
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            Mobile = recipient.Mobile,
            Email = recipient.Email,
            Subject = reservation.ReservationNumber,
            Message = "یادآوری: درخواست رزرو استعلامی هنوز در انتظار بررسی است.",
            DataJson = CreateData(reservation, link),
            DedupeKey = $"reservation:{reservation.Id}:approval-reminder:{occurrenceKey}:user:{recipient.UserId}",
            Channels = ResolveChannels(recipient.Mobile, recipient.Email)
        };
    }

    private static string CreateData(
        ReservationNotificationSnapshot reservation,
        string internalLink,
        string? rejectionReason = null) =>
        JsonSerializer.Serialize(new
        {
            reservationId = reservation.Id,
            reservationNumber = reservation.ReservationNumber,
            propertyId = reservation.PropertyId,
            property = reservation.PropertyName,
            checkInDate = reservation.CheckInDate,
            checkOutDate = reservation.CheckOutDate,
            approvalExpiresAtUtc = reservation.ApprovalExpiresAtUtc,
            remainingApprovalSeconds = reservation.ApprovalExpiresAtUtc.HasValue
                ? Math.Max(0, (long)(reservation.ApprovalExpiresAtUtc.Value - DateTime.UtcNow).TotalSeconds)
                : (long?)null,
            rejectionReason,
            internalLink
        });

    private static NotificationChannel ResolveChannels(string? mobile, string? email)
    {
        var channels = NotificationChannel.InApp;
        if (!string.IsNullOrWhiteSpace(mobile)) channels |= NotificationChannel.Sms;
        if (!string.IsNullOrWhiteSpace(email)) channels |= NotificationChannel.Email;
        return channels;
    }

    private sealed record ReservationNotificationSnapshot(
        int Id,
        string ReservationNumber,
        int ClientId,
        int? GuestId,
        string? ClientMobile,
        string? ClientEmail,
        int PropertyId,
        string PropertyName,
        DateOnly CheckInDate,
        DateOnly CheckOutDate,
        DateTime? ApprovalExpiresAtUtc,
        string? SessionCode);
}
