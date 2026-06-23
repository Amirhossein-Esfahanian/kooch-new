using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class CreateRoomTypeRequest
{
    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(150)]
    public string? EnglishName { get; set; }

    [MaxLength(170)]
    public string? Slug { get; set; }

    [Required, MaxLength(3000)]
    public string Description { get; set; } = string.Empty;

    [Range(1, int.MaxValue)]
    public int MaxAdults { get; set; }

    [Range(0, int.MaxValue)]
    public int MaxChildren { get; set; }

    public bool AllowExtraGuest { get; set; }

    [Range(0, int.MaxValue)]
    public int MaxExtraGuests { get; set; }

    [Range(0, int.MaxValue)]
    public int TotalInventory { get; set; }

    public InventoryMode InventoryMode { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? BasePrice { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public int? FloorNumber { get; set; }

    [Range(0, int.MaxValue)]
    public int? StairCount { get; set; }

    public bool? HasWindow { get; set; }
    public bool? HasPrivateBathroom { get; set; }

    public IReadOnlyCollection<RoomTypeBedRequest> BedConfigurations { get; set; } = [];
    public IReadOnlyCollection<int> AmenityIds { get; set; } = [];
}
