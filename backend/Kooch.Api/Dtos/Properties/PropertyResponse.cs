using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class PropertyResponse
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    public string OwnerName { get; set; } = string.Empty;
    public string OwnerEmail { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public int DestinationId { get; set; }
    public string DestinationName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? SeoTitle { get; set; }
    public string? SeoDescription { get; set; }
    public string Address { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public PropertyStatus Status { get; set; }
    public PropertyType Type { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public TimeOnly? CheckInTime { get; set; }
    public TimeOnly? CheckOutTime { get; set; }
    public BreakfastOption BreakfastOption { get; set; }
    public decimal? BreakfastPrice { get; set; }
    public decimal? TotalAreaM2 { get; set; }
    public decimal? LandAreaM2 { get; set; }
    public int? FloorsCount { get; set; }
    public int? StairCount { get; set; }
    public bool HasElevator { get; set; }
    public bool? IsWheelchairAccessible { get; set; }
    public bool? HasGroundFloorRoom { get; set; }
    public bool? HasAccessibleBathroom { get; set; }
    public int? FreeChildAgeLimit { get; set; }
    public int? MaxFreeChildren { get; set; }
    
}
