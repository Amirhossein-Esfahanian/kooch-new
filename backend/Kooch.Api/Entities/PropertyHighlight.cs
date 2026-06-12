namespace Kooch.Api.Entities;

public class PropertyHighlight : BaseEntity
{
    public int PropertyId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }

    public Property Property { get; set; } = null!;
}
