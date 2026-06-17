using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class RoomTypeResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
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
    public bool IsActive { get; set; }
    public IReadOnlyList<RoomTypeBedResponse> BedConfigurations { get; set; } = [];
    public IReadOnlyList<RoomTypeAmenityResponse> Amenities { get; set; } = [];
}

public class RoomTypeAmenityResponse
{
    public int AmenityId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int AmenityCategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
}
