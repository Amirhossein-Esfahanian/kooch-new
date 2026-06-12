namespace Kooch.Api.Entities;

public class RoomTypeImage : BaseEntity
{
    public int RoomTypeId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? AltText { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }

    public RoomType RoomType { get; set; } = null!;
}
