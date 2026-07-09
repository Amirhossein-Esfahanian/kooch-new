using System.ComponentModel.DataAnnotations.Schema;

namespace Kooch.Api.Entities;

public class Guest : BaseEntity
{
    public int? UserId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Mobile { get; set; }
    public string? NormalizedMobile { get; set; }
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string? NationalCode { get; set; }
    public string? PassportNumber { get; set; }
    public string? Nationality { get; set; }
    public DateOnly? BirthDate { get; set; }
    public string? Gender { get; set; }
    public string? Address { get; set; }
    public string? Notes { get; set; }
    public User? User { get; set; }
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<NotificationLog> NotificationLogs { get; set; } = [];

    [NotMapped]
    public string FullName => $"{FirstName} {LastName}".Trim();
}
