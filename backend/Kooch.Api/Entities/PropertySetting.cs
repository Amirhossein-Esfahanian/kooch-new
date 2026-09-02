namespace Kooch.Api.Entities;

public class PropertySetting : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<PropertySettingAssignment> PropertyAssignments { get; set; } = [];
}
