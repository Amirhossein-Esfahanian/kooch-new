namespace Kooch.Api.Entities;

public enum ReservationActivityVisibility
{
    Internal,
    PropertyVisible
}

public class ReservationActivity : BaseEntity
{
    public int ReservationId { get; set; }
    public int? ActorUserId { get; set; }
    public string ActorDisplayName { get; set; } = string.Empty;
    public string ActivityType { get; set; } = string.Empty;
    public ReservationActivityVisibility Visibility { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Details { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public string? RelatedEntityType { get; set; }
    public int? RelatedEntityId { get; set; }

    public Reservation Reservation { get; set; } = null!;
    public User? ActorUser { get; set; }
}
