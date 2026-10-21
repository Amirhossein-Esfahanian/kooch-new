using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class OwnerPropertyOperationalSummaryService(KoochDbContext dbContext, TimeProvider clock)
{
    public async Task<OwnerPropertyOperationalSummaryResponse> GetAsync(
        int propertyId, CancellationToken cancellationToken = default)
    {
        var businessDate = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone).DateTime);
        var reservations = dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservation.PropertyId == propertyId);
        var scheduled = reservations.Where(reservation =>
            reservation.Status == ReservationStatus.Confirmed ||
            reservation.Status == ReservationStatus.Paid);

        return new OwnerPropertyOperationalSummaryResponse
        {
            BusinessDate = businessDate,
            PendingApprovalCount = await reservations.CountAsync(reservation =>
                reservation.Status == ReservationStatus.PendingApproval ||
                reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval,
                cancellationToken),
            ScheduledArrivalsTodayCount = await scheduled.CountAsync(reservation =>
                reservation.CheckInDate == businessDate, cancellationToken),
            ScheduledDeparturesTodayCount = await scheduled.CountAsync(reservation =>
                reservation.CheckOutDate == businessDate, cancellationToken)
        };
    }
}
