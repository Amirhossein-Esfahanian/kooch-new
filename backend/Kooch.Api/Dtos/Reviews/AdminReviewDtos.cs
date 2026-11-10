using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reviews;

public sealed class AdminReviewQuery
{
    [Range(1, 100000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public ReviewModerationStatus? Status { get; set; }
    public bool? Published { get; set; }
    [Range(1, int.MaxValue)] public int? PropertyId { get; set; }
    [StringLength(200)] public string? Search { get; set; }
}

public sealed class ModerateReviewRequest
{
    [Range(1, int.MaxValue)] public int Revision { get; set; }
    [StringLength(1000)] public string? RejectionReason { get; set; }
}

public sealed record AdminReviewResponse(
    GuestReviewResponse Review, string PropertyName, string GuestDisplayName,
    string? ReservationNumber, DateOnly CheckInDate, DateOnly CheckOutDate,
    DateTime SubmittedAtUtc, int? ModeratedByUserId, DateTime? ModeratedAtUtc, string? UnpublicationReason = null);

public sealed class ReviewPublicationRequest
{
    [Range(1, int.MaxValue)] public int Revision { get; set; }
    [StringLength(1000)] public string? Reason { get; set; }
}
