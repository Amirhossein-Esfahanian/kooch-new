using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reviews;

public sealed class GuestReviewRequest
{
    [Range(1, 10)] public int CleanlinessRating { get; set; }
    [Range(1, 10)] public int StaffRating { get; set; }
    [Range(1, 10)] public int ComfortRating { get; set; }
    [Range(1, 10)] public int FacilitiesRating { get; set; }
    [Range(1, 10)] public int LocationRating { get; set; }
    [Range(1, 10)] public int ValueRating { get; set; }
    [StringLength(4000)] public string? Comment { get; set; }
    // Required on PUT; prevents a stale tab from overwriting a newer revision.
    public int? Revision { get; set; }
}

public sealed record GuestReviewResponse(
    int Id, int ReservationId, int PropertyId,
    int CleanlinessRating, int StaffRating, int ComfortRating,
    int FacilitiesRating, int LocationRating, int ValueRating,
    int RatingSum, decimal OverallRating, string Comment,
    ReviewModerationStatus ModerationStatus, bool IsPublished, int Revision);

public sealed record EligibleReviewReservationResponse(
    int ReservationId, string? ReservationNumber, int PropertyId, string PropertyName,
    DateOnly CheckOutDate, DateOnly SubmissionDeadlineLocalDate, int? ReviewId, int? Revision);

public sealed record GuestReviewListItemResponse(
    string? ReservationNumber, string PropertyName, DateOnly CheckInDate, DateOnly CheckOutDate,
    DateOnly SubmissionDeadlineLocalDate, GuestReviewResponse Review, bool CanEdit);
