namespace Kooch.Api.Entities;

public class NotificationLog : BaseEntity
{
    public int? RecipientUserId { get; set; }
    public int? RecipientGuestId { get; set; }
    public int? PropertyId { get; set; }
    public int? ReservationId { get; set; }
    public NotificationEventType EventType { get; set; }
    public NotificationChannel Channels { get; set; }
    public string Recipient { get; set; } = string.Empty;
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Subject { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? DataJson { get; set; }
    public string? DedupeKey { get; set; }
    public NotificationStatus Status { get; set; }
    public DateTime? SentAtUtc { get; set; }
    public string? Error { get; set; }

    public User? RecipientUser { get; set; }
    public Guest? RecipientGuest { get; set; }
    public Property? Property { get; set; }
    public Reservation? Reservation { get; set; }
}
