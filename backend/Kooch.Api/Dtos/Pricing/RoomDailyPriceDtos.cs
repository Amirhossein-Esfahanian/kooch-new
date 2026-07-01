namespace Kooch.Api.Dtos.Pricing;

using Kooch.Api.Entities;

public class PropertyPricingResponse
{
    public int PropertyId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public PricingGuestType GuestType { get; set; }
    public IReadOnlyList<PricingRoomTypeResponse> RoomTypes { get; set; } = [];
}

public class PricingRoomTypeResponse
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public IReadOnlyList<RoomDailyPriceResponse> Days { get; set; } = [];
}

public class RoomDailyPriceResponse
{
    public int? Id { get; set; }
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
    public PricingGuestType GuestType { get; set; }
    public decimal BasePrice { get; set; }
    public decimal ChildPrice { get; set; }
    public decimal ExtraGuestPrice { get; set; }
}

public class BulkRoomDailyPriceRequest
{
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public IReadOnlyList<RoomDailyPriceCellRequest> Items { get; set; } = [];
    public decimal BasePrice { get; set; }
    public decimal ChildPrice { get; set; }
    public decimal ExtraGuestPrice { get; set; }
}

public class RoomDailyPriceCellRequest
{
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
}

public class RoomDailyPriceHistoryResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public int RoomId { get; set; }
    public string RoomName { get; set; } = string.Empty;
    public PricingGuestType GuestType { get; set; }
    public DateOnly AffectedDateFrom { get; set; }
    public DateOnly AffectedDateTo { get; set; }
    public decimal OldBasePrice { get; set; }
    public decimal NewBasePrice { get; set; }
    public decimal OldChildPrice { get; set; }
    public decimal NewChildPrice { get; set; }
    public decimal OldExtraGuestPrice { get; set; }
    public decimal NewExtraGuestPrice { get; set; }
    public int? ChangedByUserId { get; set; }
    public string User { get; set; } = string.Empty;
    public DateTime DateTime { get; set; }
}
