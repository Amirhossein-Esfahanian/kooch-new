using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public sealed class CreatePropertyRoomRequest
{
    [Required, MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? EnglishName { get; set; }

    [MaxLength(3000)]
    public string? Description { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public int? FloorNumber { get; set; }

    [Range(0, int.MaxValue)]
    public int? StairCount { get; set; }

    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }

    [EnumDataType(typeof(RoomKind))]
    public RoomKind RoomKind { get; set; }

    [Range(1, int.MaxValue)]
    public int MaxAdults { get; set; }

    [Range(0, int.MaxValue)]
    public int MaxChildren { get; set; }

    public bool AllowExtraGuest { get; set; }

    [Range(0, int.MaxValue)]
    public int MaxExtraGuests { get; set; }

    [EnumDataType(typeof(InventoryMode))]
    public InventoryMode InventoryMode { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? BasePrice { get; set; }

    public IReadOnlyCollection<RoomTypeBedRequest> BedConfigurations { get; set; } = [];
    public IReadOnlyCollection<int> AmenityIds { get; set; } = [];
}
