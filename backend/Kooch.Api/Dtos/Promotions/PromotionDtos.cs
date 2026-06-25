using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Promotions;

public sealed class PromotionUpsertRequest
{
    public int? PropertyId { get; set; }

    [Required, MaxLength(150)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? InternalDescription { get; set; }

    [MaxLength(1000)]
    public string? PublicDescription { get; set; }

    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public IReadOnlyList<DayOfWeek> Weekdays { get; set; } = [];
    public IReadOnlyList<int> RoomTypeIds { get; set; } = [];
    public PromotionType Type { get; set; }
    public decimal? Percentage { get; set; }
    public decimal? Amount { get; set; }
    public int? LastMinuteDays { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsPublished { get; set; }
}

public sealed class PromotionResponse
{
    public int Id { get; set; }
    public int? PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? InternalDescription { get; set; }
    public string? PublicDescription { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public IReadOnlyList<DayOfWeek> Weekdays { get; set; } = [];
    public PromotionType Type { get; set; }
    public decimal? Percentage { get; set; }
    public decimal? Amount { get; set; }
    public int? LastMinuteDays { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public bool IsPublished { get; set; }
    public PromotionSource Source { get; set; }
    public int? SourcePromotionId { get; set; }
    public bool IsLibraryTemplate { get; set; }
    public bool CanEdit { get; set; }
    public int? CreatedByUserId { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public IReadOnlyList<PromotionRoomTypeResponse> RoomTypes { get; set; } = [];
}

public sealed class PromotionRoomTypeResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal? BasePrice { get; set; }
}

public sealed class PromotionStatusRequest
{
    public bool IsActive { get; set; }
}

public sealed class PromotionSortRequest
{
    public IReadOnlyList<int> PromotionIds { get; set; } = [];
}

public sealed record AppliedPromotionResponse(
    int PromotionId,
    string Title,
    decimal DiscountAmount);

public sealed record PromotionPriceResult(
    decimal BasePrice,
    decimal FinalPrice,
    IReadOnlyList<AppliedPromotionResponse> AppliedPromotions);
