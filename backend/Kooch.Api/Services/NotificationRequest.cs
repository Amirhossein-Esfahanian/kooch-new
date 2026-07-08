using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public class NotificationRequest
{
    public NotificationEventType EventType { get; set; }
    public int? RecipientUserId { get; set; }
    public int? RecipientGuestId { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Subject { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? DataJson { get; set; }
    public NotificationChannel Channels { get; set; }
}
