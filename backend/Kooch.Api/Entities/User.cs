namespace Kooch.Api.Entities;

public class User : BaseEntity
{
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public int? ParentUserId { get; set; }
    public bool CanManageUsers { get; set; }
    public bool CanBeRestricted { get; set; } = true;

    public User? ParentUser { get; set; }
    public ICollection<User> Children { get; set; } = [];
    public ICollection<UserPermission> UserPermissions { get; set; } = [];
    public ICollection<UserPropertyAccess> UserPropertyAccesses { get; set; } = [];
    public ICollection<NotificationSubscription> NotificationSubscriptions { get; set; } = [];
    public ICollection<NotificationLog> NotificationLogs { get; set; } = [];
    public ICollection<Property> OwnedProperties { get; set; } = [];
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<Review> Reviews { get; set; } = [];
}
