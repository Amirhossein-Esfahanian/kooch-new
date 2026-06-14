using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Availability;

public class AvailabilityResponse
{
    public int Id { get; set; }
    public int RoomTypeId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Price { get; set; }
    public decimal? OriginalPrice { get; set; }
    public int AvailableCount { get; set; }
    public AvailabilityStatus Status { get; set; }
    public int? MinNightsOverride { get; set; }
}
