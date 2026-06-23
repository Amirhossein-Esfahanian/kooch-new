namespace Kooch.Api.Entities;

public class Promotion : BaseEntity
{
    public int PropertyId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? InternalDescription { get; set; }
    public string? PublicDescription { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public PromotionWeekday Weekdays { get; set; }
    public PromotionType Type { get; set; }
    public decimal? Percentage { get; set; }
    public decimal? Amount { get; set; }
    public int? LastMinuteDays { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public Property Property { get; set; } = null!;
    public ICollection<PromotionRoomType> PromotionRoomTypes { get; set; } = [];
}

public class PromotionRoomType
{
    public int PromotionId { get; set; }
    public int RoomTypeId { get; set; }

    public Promotion Promotion { get; set; } = null!;
    public RoomType RoomType { get; set; } = null!;
}
