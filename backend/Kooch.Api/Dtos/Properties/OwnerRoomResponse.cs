using Kooch.Api.Catalogs;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public sealed class OwnerRoomResponse
{
    public int Id { get; set; }
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public int? FloorNumber { get; set; }
    public int? StairCount { get; set; }
    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }
    public bool IsActive { get; set; }
    public RoomKind RoomKind { get; set; }
    public string RoomKindCode => RoomKindCatalog.GetCode(RoomKind);
    public InventoryMode InventoryMode { get; set; }
    public int MaxAdults { get; set; }
    public int MaxChildren { get; set; }
    public bool AllowExtraGuest { get; set; }
    public int MaxExtraGuests { get; set; }
    public decimal? BasePrice { get; set; }
    public IReadOnlyList<RoomTypeBedResponse> BedConfigurations { get; set; } = [];
    public IReadOnlyList<RoomTypeAmenityResponse> Amenities { get; set; } = [];
}
