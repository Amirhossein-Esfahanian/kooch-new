namespace Kooch.Api.Entities;

public class PropertyImage : BaseEntity
{
    public int PropertyId { get; set; }
    public int? RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? AltText { get; set; }
    public string? Caption { get; set; }
    public string? Tag { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }
    public bool IsGallery { get; set; } = true;

    public Property Property { get; set; } = null!;
    public RoomType? RoomType { get; set; }
    public Room? Room { get; set; }
}
