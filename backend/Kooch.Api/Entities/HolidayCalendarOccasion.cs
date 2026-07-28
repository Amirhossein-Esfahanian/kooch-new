namespace Kooch.Api.Entities;

public class HolidayCalendarOccasion : BaseEntity
{
    public int HolidayCalendarDayId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string NormalizedTitle { get; set; } = string.Empty;
    public HolidayCalendarOccasionSource Source { get; set; }

    public HolidayCalendarDay HolidayCalendarDay { get; set; } = null!;
}
