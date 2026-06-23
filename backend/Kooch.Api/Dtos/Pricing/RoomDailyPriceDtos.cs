namespace Kooch.Api.Dtos.Pricing;

public class PropertyPricingResponse
{
    public int PropertyId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
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
    public decimal BasePrice { get; set; }
    public decimal ChildPrice { get; set; }
    public decimal ExtraGuestPrice { get; set; }
}

public class BulkRoomDailyPriceRequest
{
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
