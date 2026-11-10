using System.ComponentModel.DataAnnotations;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reviews;

public sealed record ReviewCategoryAverages(decimal? CleanlinessRating, decimal? StaffRating, decimal? ComfortRating,
    decimal? FacilitiesRating, decimal? LocationRating, decimal? ValueRating);
public sealed record PublicReviewSummary(int Count, decimal? OverallRating, ReviewCategoryAverages Categories)
{
    public IReadOnlyList<decimal> RecentRatings { get; init; } = [];
}
public sealed record PublicOwnerReply(string Text, DateTime? PublishedAtUtc);
public sealed record PublicGuestReview(int Id, string GuestDisplayName, DateTime SubmittedAtUtc,
    int CleanlinessRating, int StaffRating, int ComfortRating, int FacilitiesRating, int LocationRating, int ValueRating,
    decimal OverallRating, string Comment, PublicOwnerReply? OwnerReply)
{
    public string? RoomTypeName { get; init; }
    public DateOnly? CheckInDate { get; init; }
    public DateOnly? CheckOutDate { get; init; }
}
public sealed record PublicPropertyReviewsResponse(PublicReviewSummary Summary, PagedResult<PublicGuestReview> Reviews);

public sealed class OwnerReplyRequest
{
    [Required, StringLength(2000)] public string Body { get; set; } = string.Empty;
    // Omit only when creating the first response. All edits require the current version.
    public int? Revision { get; set; }
}
public sealed record OwnerReplyResponse(int Id, int ReviewId, string Body, ReviewModerationStatus ModerationStatus,
    int Revision, string? RejectionReason, string? PublishedBody, DateTime? PublishedAtUtc);
public sealed record OwnerReviewResponse(PublicGuestReview Review, OwnerReplyResponse? Reply);
public sealed record AdminOwnerReplyResponse(OwnerReplyResponse Reply, int PropertyId, string PropertyName,
    PublicGuestReview GuestReview, int SubmittedByUserId, int? ModeratedByUserId, DateTime? ModeratedAtUtc,
    DateTime SubmittedAtUtc);
