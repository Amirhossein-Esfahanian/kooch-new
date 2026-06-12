namespace Kooch.Api.Entities;

public class Promotion : BaseEntity
{
    public int? PropertyId { get; set; }
    public int? RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Code { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public PromotionScope Scope { get; set; }
    public DiscountType DiscountType { get; set; }
    public decimal DiscountValue { get; set; }
    public int? MinimumNights { get; set; }
    public bool IsActive { get; set; } = true;

    public Property? Property { get; set; }
    public RoomType? RoomType { get; set; }
}
