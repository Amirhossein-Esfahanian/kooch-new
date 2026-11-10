namespace Kooch.Api.Entities;

public sealed class ReviewOwnerReply : BaseEntity
{
    public int ReviewId { get; set; }
    public string Body { get; set; } = string.Empty;
    public ReviewModerationStatus ModerationStatus { get; set; } = ReviewModerationStatus.PendingApproval;
    public int Revision { get; set; } = 1;
    public int SubmittedByUserId { get; set; }
    public string? RejectionReason { get; set; }
    public int? ModeratedByUserId { get; set; }
    public DateTime? ModeratedAtUtc { get; set; }
    // Keep the last approved version public while a replacement awaits moderation.
    public string? PublishedBody { get; set; }
    public int? PublishedRevision { get; set; }
    public DateTime? PublishedAtUtc { get; set; }
    public Review Review { get; set; } = null!;
}
