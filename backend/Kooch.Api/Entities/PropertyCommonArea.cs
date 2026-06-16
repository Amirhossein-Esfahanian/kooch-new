namespace Kooch.Api.Entities;

public class PropertyCommonArea : BaseEntity
{
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }

    public Property Property { get; set; } = null!;
}
