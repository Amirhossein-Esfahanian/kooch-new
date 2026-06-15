namespace Kooch.Api.Dtos.Properties;

public class PropertyImageResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public int? RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? AltText { get; set; }
    public string? Caption { get; set; }
    public string? Tag { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }
    public bool IsGallery { get; set; }
}
