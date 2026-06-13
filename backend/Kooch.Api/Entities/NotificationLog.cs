namespace Kooch.Api.Entities;

public class NotificationLog : BaseEntity
{
    public int? UserId { get; set; }
    public int? PropertyId { get; set; }
    public int? ReservationId { get; set; }
    public NotificationEventType EventType { get; set; }
    public NotificationChannel Channel { get; set; }
    public string Recipient { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public NotificationStatus Status { get; set; }
    public DateTime? SentAtUtc { get; set; }
    public string? ErrorMessage { get; set; }

    public User? User { get; set; }
    public Property? Property { get; set; }
    public Reservation? Reservation { get; set; }
}
