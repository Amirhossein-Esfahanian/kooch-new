namespace Kooch.Api.Entities;

public class PropertySettingAssignment : BaseEntity
{
    public int PropertyId { get; set; }
    public int PropertySettingId { get; set; }

    public Property Property { get; set; } = null!;
    public PropertySetting PropertySetting { get; set; } = null!;
}
