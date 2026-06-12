namespace Kooch.Api.Entities;

public class PropertyImage : BaseEntity
{
    public int PropertyId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? AltText { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }

    public Property Property { get; set; } = null!;
}
