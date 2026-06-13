namespace Kooch.Api.Entities;

public class NotificationSubscription : BaseEntity
{
    public int UserId { get; set; }
    public int? PropertyId { get; set; }
    public NotificationEventType EventType { get; set; }
    public NotificationChannel Channel { get; set; }
    public bool IsEnabled { get; set; } = true;

    public User User { get; set; } = null!;
    public Property? Property { get; set; }
}
