namespace Kooch.Api.Entities;

public class UserPropertyAccess : BaseEntity
{
    public int UserId { get; set; }
    public int PropertyId { get; set; }
    public bool CanManageProperty { get; set; }
    public bool CanManageRooms { get; set; }
    public bool CanManageAvailability { get; set; }
    public bool CanManagePricing { get; set; }
    public bool CanManageReservations { get; set; }
    public bool CanManagePayments { get; set; }
    public bool CanManageReviews { get; set; }
    public bool CanManageNotifications { get; set; }
    public bool CanViewReports { get; set; }
    public bool IsActive { get; set; } = true;

    public User User { get; set; } = null!;
    public Property Property { get; set; } = null!;
}
