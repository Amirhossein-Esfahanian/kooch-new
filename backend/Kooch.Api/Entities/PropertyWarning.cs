namespace Kooch.Api.Entities;

public class PropertyWarning : BaseEntity
{
    public int PropertyId { get; set; }
    public WarningType Type { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }

    public Property Property { get; set; } = null!;
}
