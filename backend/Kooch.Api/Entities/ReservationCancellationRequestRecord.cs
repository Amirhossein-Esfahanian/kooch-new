namespace Kooch.Api.Entities;

public enum ReservationCancellationRequestStatus
{
    Pending = 0,
    Resolved = 1,
    Rejected = 2
}

public class ReservationCancellationRequestRecord : BaseEntity
{
    public int ReservationId { get; set; }
    public int RequestedByUserId { get; set; }
    public ReservationCancellationRequestStatus Status { get; set; } = ReservationCancellationRequestStatus.Pending;
    public ReservationCancellationReason Reason { get; set; }
    public string? GuestMessage { get; set; }
    public DateTime RequestedAtUtc { get; set; }
    public DateTime? ResolvedAtUtc { get; set; }
    public int? ResolvedByUserId { get; set; }
    public string? ResolutionNote { get; set; }

    public Reservation Reservation { get; set; } = null!;
    public User RequestedByUser { get; set; } = null!;
    public User? ResolvedByUser { get; set; }
}
