using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reservations;

public sealed class ReservationActivityResponse
{
    public int Id { get; set; }
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
}

public sealed class CreateReservationInternalNoteRequest
{
    public string? Details { get; set; }
}

public sealed class OwnerReservationActivityQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public sealed class OwnerReservationActivityResponse
{
    public string ActivityType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Details { get; set; }
    public string ActorDisplayName { get; set; } = string.Empty;
    public DateTime OccurredAtUtc { get; set; }
}
