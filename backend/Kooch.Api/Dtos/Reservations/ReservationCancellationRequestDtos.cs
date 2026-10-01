using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reservations;

public sealed class CreateReservationCancellationRequest
{
    public ReservationCancellationReason? Reason { get; set; }
    public string? Message { get; set; }
}

public sealed class ReservationCancellationRequestResponse
{
    public ReservationCancellationRequestStatus Status { get; set; }
    public ReservationCancellationReason Reason { get; set; }
    public string? Message { get; set; }
    public DateTime RequestedAtUtc { get; set; }
    public DateTime? ResolvedAtUtc { get; set; }
}
