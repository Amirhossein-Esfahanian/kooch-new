using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class PublicPropertyResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string? SeoTitle { get; set; }
    public string? SeoDescription { get; set; }
    public string City { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string? CoverImageUrl { get; set; }
    public PropertyStatus Status { get; set; }
    public PropertyType PropertyType { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public TimeOnly? CheckInTime { get; set; }
    public TimeOnly? CheckOutTime { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public bool HasElevator { get; set; }
    public bool? IsWheelchairAccessible { get; set; }
    public bool? HasGroundFloorRoom { get; set; }
    public bool? HasAccessibleBathroom { get; set; }
    public bool IsInstantBooking { get; set; }
    public decimal? StartingPrice { get; set; }
    public int MatchingRoomTypesCount { get; set; }
    public IReadOnlyList<PublicRoomTypeSummaryResponse> MatchingRoomTypes { get; set; } = [];
    public string GuestFitStatus { get; set; } = "ظرفیت نامشخص";
    public string AvailabilitySummary { get; set; } = "فعلاً همه موجود فرض شده‌اند";
    public string AvailabilityStatusSummary { get; set; } = "Unknown";
    public int? FreeChildAgeLimit { get; set; }
    public int? MaxFreeChildren { get; set; }
    public IReadOnlyList<PublicImageResponse> Images { get; set; } = [];
    public IReadOnlyList<PublicDescriptionSectionResponse> DescriptionSections { get; set; } = [];
    public IReadOnlyList<PublicCommonAreaResponse> CommonAreas { get; set; } = [];
    public IReadOnlyList<PublicAmenityResponse> Amenities { get; set; } = [];
    public IReadOnlyList<PublicNearbyPlaceResponse> NearbyPlaces { get; set; } = [];
    public IReadOnlyList<PropertyViewType> Views { get; set; } = [];
    public IReadOnlyList<PublicRoomTypeResponse> RoomTypes { get; set; } = [];
}

public class PublicRoomTypeSummaryResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public int TotalInventory { get; set; }
    public decimal? DisplayPrice { get; set; }
}

public class PublicPropertySuggestionResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
}

public class PublicRoomTypeResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal? BasePrice { get; set; }
    public decimal? AvailabilityPrice { get; set; }
    public decimal? DisplayPrice { get; set; }
    public AvailabilityStatus? AvailabilityStatus { get; set; }
    public InventoryMode InventoryMode { get; set; }
    public int TotalInventory { get; set; }
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public string? Notes { get; set; }
    public int? FloorNumber { get; set; }
    public int? StairCount { get; set; }
    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }
    public IReadOnlyList<string> BedInformation { get; set; } = [];
    public IReadOnlyList<PublicImageResponse> Images { get; set; } = [];
    public IReadOnlyList<PublicAmenityResponse> Amenities { get; set; } = [];
}

public class PublicImageResponse
{
    public int Id { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? AltText { get; set; }
    public string? Caption { get; set; }
    public string? Tag { get; set; }
    public bool IsCover { get; set; }
}

public class PublicDescriptionSectionResponse
{
    public PropertyDescriptionSectionType SectionType { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

public class PublicAmenityResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
}

public class PublicCommonAreaResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
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
