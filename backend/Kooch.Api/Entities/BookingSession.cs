namespace Kooch.Api.Entities;

public class BookingSession : BaseEntity
{
    public string SessionCode { get; set; } = string.Empty;
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string? IdempotencyKey { get; set; }
    public string? RequestHash { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public User Client { get; set; } = null!;
    public Guest? Guest { get; set; }
    public Property Property { get; set; } = null!;
    public ICollection<Reservation> Reservations { get; set; } = [];
}
