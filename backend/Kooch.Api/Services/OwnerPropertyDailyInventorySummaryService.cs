using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class OwnerPropertyDailyInventorySummaryService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    TimeProvider clock)
{
    public async Task<OwnerPropertyDailyInventorySummaryResponse> GetAsync(
        int propertyId, CancellationToken cancellationToken = default)
    {
        var today = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone).DateTime);
        var roomTypeIds = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive)
            .Select(roomType => roomType.Id)
            .ToArrayAsync(cancellationToken);
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypeIds, today, today.AddDays(1), cancellationToken: cancellationToken);
        var nights = roomTypeIds.Select(id => availability[id].Nights[today]).ToArray();
        // Calendar configuration remains eligible when fully allocated; it is not a closure.
        var openNights = nights.Where(night => !night.IsClosed &&
            night.ConfiguredStatus is AvailabilityStatus.Available or AvailabilityStatus.OnRequest).ToArray();

        return new OwnerPropertyDailyInventorySummaryResponse
        {
            PropertyId = propertyId,
            BusinessDate = today,
            ConfiguredUnits = nights.Sum(night => (long)night.ConfiguredCapacity),
            EligibleConfiguredUnits = openNights.Sum(night => (long)night.ConfiguredCapacity),
            ReservedAllocatedUnits = nights.Sum(night => (long)night.ClaimedCapacity),
            RemainingUnits = openNights.Sum(night => (long)night.RemainingCapacity),
            AvailableModeRemainingUnits = openNights
                .Where(night => night.ConfiguredStatus == AvailabilityStatus.Available)
                .Sum(night => (long)night.RemainingCapacity),
            OnRequestRemainingUnits = openNights
                .Where(night => night.ConfiguredStatus == AvailabilityStatus.OnRequest)
                .Sum(night => (long)night.RemainingCapacity),
            BlockedRoomTypeCount = nights.Length - openNights.Length
        };
    }
}
