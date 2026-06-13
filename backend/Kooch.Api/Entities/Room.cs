namespace Kooch.Api.Entities;

public class Room : BaseEntity
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public int? FloorNumber { get; set; }
    public int? StairCount { get; set; }
    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }
    public bool IsActive { get; set; } = true;

    public RoomType RoomType { get; set; } = null!;
    public ICollection<PropertyImage> PropertyImages { get; set; } = [];
    public ICollection<Reservation> Reservations { get; set; } = [];
}
