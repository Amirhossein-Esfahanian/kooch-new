using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class CreateRoomTypeRequest
{
    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [Required, MaxLength(170)]
    public string Slug { get; set; } = string.Empty;

    [Required, MaxLength(3000)]
    public string Description { get; set; } = string.Empty;

    [Range(1, int.MaxValue)]
    public int MaxAdults { get; set; }

    [Range(0, int.MaxValue)]
    public int MaxChildren { get; set; }

    [Range(0, int.MaxValue)]
    public int TotalInventory { get; set; }

    public InventoryMode InventoryMode { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? BasePrice { get; set; }
}
