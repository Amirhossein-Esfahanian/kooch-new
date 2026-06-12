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

    public ICollection<Property> OwnedProperties { get; set; } = [];
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<Review> Reviews { get; set; } = [];
}
