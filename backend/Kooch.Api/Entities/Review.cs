namespace Kooch.Api.Entities;

public class Review : BaseEntity
{
    public int PropertyId { get; set; }
    public int ClientId { get; set; }
    public int? ReservationId { get; set; }
    public int Rating { get; set; }
    public int? CleanlinessRating { get; set; }
    public int? LocationRating { get; set; }
    public int? StaffRating { get; set; }
    public int? ValueRating { get; set; }
    public string? Title { get; set; }
    public string Comment { get; set; } = string.Empty;
    public bool IsPublished { get; set; }

    public Property Property { get; set; } = null!;
    public User Client { get; set; } = null!;
    public Reservation? Reservation { get; set; }
}
