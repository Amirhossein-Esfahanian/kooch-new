namespace Kooch.Api.Entities;

public class HolidayCalendarDayOverride : BaseEntity
{
    public int HolidayCalendarDayId { get; set; }
    public bool? IsWeeklyHoliday { get; set; }
    public bool? IsOfficialHoliday { get; set; }
    public string? Note { get; set; }

    public HolidayCalendarDay HolidayCalendarDay { get; set; } = null!;
}
