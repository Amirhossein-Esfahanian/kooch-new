namespace Kooch.Api.Entities;

public class PropertyDescriptionSection : BaseEntity
{
    public int PropertyId { get; set; }
    public PropertyDescriptionSectionType SectionType { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    public Property Property { get; set; } = null!;
}
