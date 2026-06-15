using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class PublicPropertyResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? CoverImageUrl { get; set; }
    public PropertyStatus Status { get; set; }
    public PropertyType PropertyType { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public decimal? StartingPrice { get; set; }
    public IReadOnlyList<string> ImageUrls { get; set; } = [];
    public IReadOnlyList<PublicAmenityResponse> Amenities { get; set; } = [];
    public IReadOnlyList<PublicNearbyPlaceResponse> NearbyPlaces { get; set; } = [];
    public IReadOnlyList<PublicRoomTypeResponse> RoomTypes { get; set; } = [];
}

public class PublicRoomTypeResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal? BasePrice { get; set; }
    public decimal? AvailabilityPrice { get; set; }
    public decimal? DisplayPrice { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public int TotalInventory { get; set; }
    public IReadOnlyList<PublicRoomResponse> NamedRooms { get; set; } = [];
}

public class PublicRoomResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class PublicAmenityResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
}

public class PublicNearbyPlaceResponse
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public NearbyPlaceCategory Category { get; set; }
    public int? DistanceInMeters { get; set; }
    public int? WalkingMinutes { get; set; }
    public int? DrivingMinutes { get; set; }
    public string? Description { get; set; }
}
