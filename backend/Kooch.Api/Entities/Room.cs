namespace Kooch.Api.Entities;

public class Room : BaseEntity
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;

    public RoomType RoomType { get; set; } = null!;
    public ICollection<Reservation> Reservations { get; set; } = [];
}
