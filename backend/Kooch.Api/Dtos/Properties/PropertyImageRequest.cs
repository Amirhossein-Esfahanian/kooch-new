using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class PropertyImageRequest
{
    [Required, MaxLength(2000)]
    public string Url { get; set; } = string.Empty;

    [MaxLength(300)]
    public string? AltText { get; set; }

    [MaxLength(500)]
    public string? Caption { get; set; }

    [MaxLength(100)]
    public string? Tag { get; set; }

    public int? RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }
    public bool IsGallery { get; set; } = true;
}
