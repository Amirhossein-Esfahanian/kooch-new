using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class PropertyDescriptionSectionRequest
{
    public PropertyDescriptionSectionType SectionType { get; set; }

    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [Required, MaxLength(4000)]
    public string Content { get; set; } = string.Empty;

    public int SortOrder { get; set; }
}
