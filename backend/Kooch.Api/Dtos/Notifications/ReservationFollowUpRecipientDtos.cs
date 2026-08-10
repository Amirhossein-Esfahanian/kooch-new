using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Notifications;

public sealed class ReservationFollowUpRecipientResponse
{
    public int UserId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? PhoneNumber { get; set; }
    public bool IsActive { get; set; }
}

public sealed class ReservationFollowUpCandidateResponse
{
    public int UserId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? PhoneNumber { get; set; }
}

public sealed class AssignReservationFollowUpRecipientRequest
{
    [Range(1, int.MaxValue)]
    public int UserId { get; set; }
}
