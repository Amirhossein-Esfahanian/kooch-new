namespace Kooch.Api.Dtos.Properties;

public sealed class OwnerPropertyVisitAnalyticsResponse
{
    public DateOnly BusinessDate { get; init; }
    public int TodayRecordedVisits { get; init; }
    public int Last7DaysTotal { get; init; }
    public int Last30DaysTotal { get; init; }
    public int Last90DaysTotal { get; init; }
    public IReadOnlyList<PropertyVisitDailyCount> DailyVisits { get; init; } = [];
}

public sealed record PropertyVisitDailyCount(DateOnly BusinessDate, int RecordedVisits);
