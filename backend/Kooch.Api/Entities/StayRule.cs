namespace Kooch.Api.Entities;

public class StayRule : BaseEntity
{
    public int? PropertyId { get; set; }
    public int? RoomTypeId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public int MinNights { get; set; }
    public int? MaxNights { get; set; }
    public bool ClosedToArrival { get; set; }
    public bool ClosedToDeparture { get; set; }

    public Property? Property { get; set; }
    public RoomType? RoomType { get; set; }
}
