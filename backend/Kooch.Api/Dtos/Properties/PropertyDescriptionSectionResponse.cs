using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class PropertyDescriptionSectionResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public PropertyDescriptionSectionType SectionType { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}
