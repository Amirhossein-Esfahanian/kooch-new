using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class OwnerPropertyVisitAnalyticsService(KoochDbContext dbContext, TimeProvider clock)
{
    public async Task<OwnerPropertyVisitAnalyticsResponse> GetAsync(
        int propertyId, CancellationToken cancellationToken = default)
    {
        var today = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone).DateTime);
        var firstDay = today.AddDays(-89);
        var recordedCounts = await dbContext.PropertyVisits.AsNoTracking()
            .Where(visit => visit.PropertyId == propertyId &&
                visit.BusinessDate >= firstDay && visit.BusinessDate <= today)
            .GroupBy(visit => visit.BusinessDate)
            .Select(group => new { BusinessDate = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);
        var countsByDate = recordedCounts.ToDictionary(item => item.BusinessDate, item => item.Count);
        var dailyVisits = Enumerable.Range(0, 90)
            .Select(offset =>
            {
                var date = firstDay.AddDays(offset);
                return new PropertyVisitDailyCount(date, countsByDate.GetValueOrDefault(date));
            })
            .ToArray();

        return new OwnerPropertyVisitAnalyticsResponse
        {
            BusinessDate = today,
            TodayRecordedVisits = dailyVisits[^1].RecordedVisits,
            Last7DaysTotal = dailyVisits[^7..].Sum(day => day.RecordedVisits),
            Last30DaysTotal = dailyVisits[^30..].Sum(day => day.RecordedVisits),
            Last90DaysTotal = dailyVisits.Sum(day => day.RecordedVisits),
            DailyVisits = dailyVisits
        };
    }
}
