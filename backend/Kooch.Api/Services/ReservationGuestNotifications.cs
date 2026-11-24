using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class ReservationGuestNotifications
{
    private static async Task<int?> ResolveUserIdAsync(KoochDbContext context, Reservation reservation, CancellationToken ct)
    {
        if (reservation.Source != ReservationSource.AdminCreated) return reservation.ClientId;
        var userId = await context.Guests.AsNoTracking()
            .Where(guest => guest.Id == reservation.GuestId && !guest.IsDeleted &&
                guest.User != null && !guest.User.IsDeleted && guest.User.IsActive)
            .Select(guest => guest.UserId).SingleOrDefaultAsync(ct);
        return userId == (reservation.CreatedByUserId ?? reservation.ClientId) ? null : userId;
    }

    internal static async Task SendExistingAsync(KoochDbContext context, INotificationService notifications,
        Reservation reservation, NotificationRequest request, CancellationToken ct)
    {
        if (reservation.Source == ReservationSource.AdminCreated)
        {
            var userId = await ResolveUserIdAsync(context, reservation, ct);
            if (!userId.HasValue) return;
            request.RecipientUserId = userId;
            request.DedupeKey = $"reservation:{reservation.Id}:{request.EventType}:guest:{userId}";
            request.Channels = NotificationChannel.InApp;
            request.Mobile = null;
            request.Email = null;
        }
        await notifications.SendAsync(request, ct);
    }

    // Call inside the successful operation's transaction, after its state has been saved.
    internal static async Task SendAsync(
        KoochDbContext context,
        INotificationService notifications,
        Reservation reservation,
        NotificationEventType eventType,
        string message,
        CancellationToken cancellationToken,
        int? paymentId = null,
        string? occurrenceKey = null)
    {
        var recipientId = await ResolveUserIdAsync(context, reservation, cancellationToken);
        if (!recipientId.HasValue) return;

        await notifications.SendAsync(new NotificationRequest
        {
            EventType = eventType,
            RecipientUserId = recipientId,
            RecipientGuestId = reservation.GuestId,
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            Subject = reservation.ReservationNumber,
            Message = message,
            Channels = NotificationChannel.InApp,
            DedupeKey = $"reservation:{reservation.Id}:{occurrenceKey ?? eventType.ToString()}:guest:{recipientId}",
            DataJson = JsonSerializer.Serialize(new
            {
                reservationId = reservation.Id,
                reservationNumber = reservation.ReservationNumber,
                reservation.PropertyId,
                reservation.CheckInDate,
                reservation.CheckOutDate,
                reservation.PaymentExpiresAtUtc,
                reservationStatus = reservation.Status.ToString(),
                paymentId
            })
        }, cancellationToken);
    }
}
