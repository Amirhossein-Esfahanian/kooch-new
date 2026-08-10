namespace Kooch.Api.Entities;

public sealed class PropertyReservationFollowUpRecipient : BaseEntity
{
    public int PropertyId { get; set; }
    public int UserId { get; set; }
    public bool IsActive { get; set; } = true;

    public Property Property { get; set; } = null!;
    public User User { get; set; } = null!;
}
