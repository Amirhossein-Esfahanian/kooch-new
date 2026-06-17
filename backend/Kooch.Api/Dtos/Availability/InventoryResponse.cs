using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Availability;

public class PropertyInventoryResponse
{
    public int PropertyId { get; set; }
    public string Month { get; set; } = string.Empty;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public IReadOnlyList<InventoryRoomTypeResponse> RoomTypes { get; set; } = [];
}

public class InventoryRoomTypeResponse
{
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public InventoryMode InventoryMode { get; set; }
    public int TotalInventory { get; set; }
    public IReadOnlyList<InventoryDayResponse> Days { get; set; } = [];
}

public class InventoryDayResponse
{
    public int? AvailabilityId { get; set; }
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
    public int AvailableCount { get; set; }
    public AvailabilityStatus Status { get; set; }
}
