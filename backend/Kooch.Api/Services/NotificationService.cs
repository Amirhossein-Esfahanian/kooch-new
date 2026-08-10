using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class NotificationService(KoochDbContext dbContext) : INotificationService
{
    public async Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
        {
            throw new ArgumentException("Notification message is required.", nameof(request));
        }

        if (request.Channels == NotificationChannel.None)
        {
            throw new ArgumentException("At least one notification channel is required.", nameof(request));
        }

        var dedupeKey = string.IsNullOrWhiteSpace(request.DedupeKey)
            ? null
            : request.DedupeKey.Trim();
        if (dedupeKey is not null && await dbContext.NotificationLogs.AsNoTracking()
                .AnyAsync(log => log.DedupeKey == dedupeKey, cancellationToken))
        {
            return;
        }

        var log = new NotificationLog
        {
            EventType = request.EventType,
            RecipientUserId = request.RecipientUserId,
            RecipientGuestId = request.RecipientGuestId,
            PropertyId = request.PropertyId,
            ReservationId = request.ReservationId,
            Mobile = request.Mobile,
            Email = request.Email,
            Subject = request.Subject,
            Message = request.Message,
            DataJson = request.DataJson,
            DedupeKey = dedupeKey,
            Channels = request.Channels,
            Recipient = GetRecipient(request),
            Status = NotificationStatus.Logged
        };

        dbContext.NotificationLogs.Add(log);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string GetRecipient(NotificationRequest request)
    {
        if (request.RecipientUserId is not null)
        {
            return $"user:{request.RecipientUserId}";
        }

        if (request.RecipientGuestId is not null)
        {
            return $"guest:{request.RecipientGuestId}";
        }

        if (!string.IsNullOrWhiteSpace(request.Mobile))
        {
            return request.Mobile;
        }

        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            return request.Email;
        }

        return "unknown";
    }
}
