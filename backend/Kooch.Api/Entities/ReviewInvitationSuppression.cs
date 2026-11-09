namespace Kooch.Api.Entities;

public sealed class ReviewInvitationSuppression : BaseEntity
{
    public int UserId { get; set; }
    public int ReservationId { get; set; }
    public User User { get; set; } = null!;
    public Reservation Reservation { get; set; } = null!;
}
