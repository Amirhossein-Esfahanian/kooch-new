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
    public int RoomId { get; set; }
    public string RoomName { get; set; } = string.Empty;
    public PricingGuestType GuestType { get; set; }
    public decimal OldPrice { get; set; }
    public decimal NewPrice { get; set; }
    public int UserId { get; set; }
    public string User { get; set; } = string.Empty;
    public DateTime DateTime { get; set; }
    public DateOnly AffectedStartDate { get; set; }
    public DateOnly AffectedEndDate { get; set; }
}
