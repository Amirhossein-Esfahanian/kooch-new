namespace Kooch.Api.Entities;

public class Promotion : BaseEntity
{
    public int? PropertyId { get; set; }
    public int? SourcePromotionId { get; set; }
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
    public bool IsPublished { get; set; }
    public PromotionSource Source { get; set; } = PromotionSource.Owner;

    public Property? Property { get; set; }
    public Promotion? SourcePromotion { get; set; }
    public ICollection<Promotion> OwnerActivations { get; set; } = [];
    public ICollection<PromotionRoomType> PromotionRoomTypes { get; set; } = [];
}

public class PromotionRoomType
{
    public int PromotionId { get; set; }
    public int RoomTypeId { get; set; }

    public Promotion Promotion { get; set; } = null!;
    public RoomType RoomType { get; set; } = null!;
}
