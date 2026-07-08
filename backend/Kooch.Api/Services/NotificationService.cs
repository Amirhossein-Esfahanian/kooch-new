using Kooch.Api.Data;
using Kooch.Api.Entities;

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

        var log = new NotificationLog
        {
            EventType = request.EventType,
            RecipientUserId = request.RecipientUserId,
            RecipientGuestId = request.RecipientGuestId,
            Mobile = request.Mobile,
            Email = request.Email,
            Subject = request.Subject,
            Message = request.Message,
            DataJson = request.DataJson,
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
