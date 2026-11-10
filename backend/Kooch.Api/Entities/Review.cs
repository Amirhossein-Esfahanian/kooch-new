namespace Kooch.Api.Entities;

public class Review : BaseEntity
{
    public int PropertyId { get; set; }
    public int ClientId { get; set; }
    public int? ReservationId { get; set; }
    // Historical 1–5 score. New six-category reviews use RatingSum without rounding.
    public int Rating { get; set; }
    public int? CleanlinessRating { get; set; }
    public int? LocationRating { get; set; }
    public int? StaffRating { get; set; }
    public int? ValueRating { get; set; }
    public int? ComfortRating { get; set; }
    public int? FacilitiesRating { get; set; }
    public int? RatingSum { get; set; }
    public ReviewModerationStatus? ModerationStatus { get; set; }
    public int Revision { get; set; }
    public string? RejectionReason { get; set; }
    public string? UnpublicationReason { get; set; }
    public int? ModeratedByUserId { get; set; }
    public DateTime? ModeratedAtUtc { get; set; }
    public string? Title { get; set; }
    public string Comment { get; set; } = string.Empty;
    public bool IsPublished { get; set; }

    public Property Property { get; set; } = null!;
    public User Client { get; set; } = null!;
    public Reservation? Reservation { get; set; }
}

public enum ReviewModerationStatus { PendingApproval = 0, Approved = 1, Rejected = 2 }
