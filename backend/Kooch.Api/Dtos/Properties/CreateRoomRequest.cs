using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class CreateRoomRequest
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
}
