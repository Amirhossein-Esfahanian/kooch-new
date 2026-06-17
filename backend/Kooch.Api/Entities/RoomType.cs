namespace Kooch.Api.Entities;

public class RoomType : BaseEntity
{
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? SeoTitle { get; set; }
    public string? SeoDescription { get; set; }
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public int TotalInventory { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public decimal? BasePrice { get; set; }
    public string? Notes { get; set; }
    public int? FloorNumber { get; set; }
    public int? StairCount { get; set; }
    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }
    public bool IsActive { get; set; } = true;

    public Property Property { get; set; } = null!;
    public ICollection<Room> Rooms { get; set; } = [];
    public ICollection<RoomTypeBed> BedConfigurations { get; set; } = [];
    public ICollection<Availability> Availability { get; set; } = [];
    public ICollection<RoomTypeImage> Images { get; set; } = [];
    public ICollection<PropertyImage> PropertyImages { get; set; } = [];
    public ICollection<RoomTypeAmenity> RoomTypeAmenities { get; set; } = [];
    public ICollection<RatePlan> RatePlans { get; set; } = [];
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<StayRule> StayRules { get; set; } = [];
    public ICollection<Promotion> Promotions { get; set; } = [];
}
