namespace Kooch.Api.Entities;

public class Property : BaseEntity
{
    public int OwnerId { get; set; }
    public int DestinationId { get; set; }
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
    

    public User Owner { get; set; } = null!;
    public Destination Destination { get; set; } = null!;
    public SeoMetadata? SeoMetadata { get; set; }
    public ICollection<RoomType> RoomTypes { get; set; } = [];
    public ICollection<PropertyHighlight> Highlights { get; set; } = [];
    public ICollection<PropertyWarning> Warnings { get; set; } = [];
    public ICollection<PropertyImage> Images { get; set; } = [];
    public ICollection<PropertyAmenity> PropertyAmenities { get; set; } = [];
    public ICollection<PropertyTravelPurpose> PropertyTravelPurposes { get; set; } = [];
    public ICollection<NearbyPlace> NearbyPlaces { get; set; } = [];
    public ICollection<PropertyCommonArea> CommonAreas { get; set; } = [];
    public ICollection<PropertyView> Views { get; set; } = [];
    public ICollection<Review> Reviews { get; set; } = [];
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<CancellationPolicy> CancellationPolicies { get; set; } = [];
    public ICollection<StayRule> StayRules { get; set; } = [];
    public ICollection<Promotion> Promotions { get; set; } = [];
    public ICollection<UserPermission> UserPermissions { get; set; } = [];
    public ICollection<UserPropertyAccess> UserPropertyAccesses { get; set; } = [];
    public ICollection<NotificationSubscription> NotificationSubscriptions { get; set; } = [];
    public ICollection<NotificationLog> NotificationLogs { get; set; } = [];
    public ICollection<PropertyDescriptionSection> DescriptionSections { get; set; } = [];
}
