namespace Kooch.Api.Entities;

public class PropertyView : BaseEntity
{
    public int PropertyId { get; set; }
    public PropertyViewType ViewType { get; set; }

    public Property Property { get; set; } = null!;
}
