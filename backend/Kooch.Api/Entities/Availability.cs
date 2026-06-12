namespace Kooch.Api.Entities;

public class Availability : BaseEntity
{
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Price { get; set; }
    public decimal? OriginalPrice { get; set; }
    public int AvailableCount { get; set; }
    public bool IsClosed { get; set; }
    public int? MinNightsOverride { get; set; }

    public RoomType RoomType { get; set; } = null!;
}
