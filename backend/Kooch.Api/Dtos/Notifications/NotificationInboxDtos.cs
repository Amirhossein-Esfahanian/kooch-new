using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Notifications;

public sealed class NotificationInboxQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public sealed class NotificationInboxItemResponse
{
    public int Id { get; set; }
    public NotificationEventType EventType { get; set; }
    public string? Subject { get; set; }
    public string Message { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? ReadAtUtc { get; set; }
    public bool IsRead { get; set; }
    public string? ReservationNumber { get; set; }
    public int? PropertyId { get; set; }
}

public sealed class NotificationUnreadCountResponse
{
    public int UnreadCount { get; set; }
}
