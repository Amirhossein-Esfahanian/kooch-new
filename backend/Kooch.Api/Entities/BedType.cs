namespace Kooch.Api.Entities;

public class BedType : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;

    public ICollection<RoomTypeBed> RoomTypeBeds { get; set; } = [];
}
