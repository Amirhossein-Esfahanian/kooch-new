using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Availability;

public class BulkInventoryRequest
{
    public int? RoomTypeId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    [Range(0, int.MaxValue)]
    public int AvailableCount { get; set; }
}

public class UpsertInventoryRequest
{
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }

    [Range(0, int.MaxValue)]
    public int AvailableCount { get; set; }
}

public class BulkInventoryCellsRequest
{
    [MinLength(1)]
    public IReadOnlyList<BulkInventoryCellItem> Items { get; set; } = [];

    [Range(0, int.MaxValue)]
    public int AvailableCount { get; set; }

    public AvailabilityStatus Status { get; set; } = AvailabilityStatus.Available;
}

public class BulkInventoryCellItem
{
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
}
