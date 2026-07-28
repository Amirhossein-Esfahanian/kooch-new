namespace Kooch.Api.Entities;

public class HolidayCalendarDay : BaseEntity
{
    public DateOnly GregorianDate { get; set; }
    public int SolarYear { get; set; }
    public int SolarMonth { get; set; }
    public int SolarDay { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    public bool IsWeeklyHoliday { get; set; }
    public bool IsOfficialHoliday { get; set; }
    public string ProviderName { get; set; } = string.Empty;
    public int SourceSolarYear { get; set; }
    public DateTime LastProviderSyncAtUtc { get; set; }

    public ICollection<HolidayCalendarOccasion> Occasions { get; set; } = [];
    public HolidayCalendarDayOverride? Override { get; set; }
}
