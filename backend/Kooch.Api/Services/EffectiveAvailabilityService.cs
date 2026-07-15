using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class EffectiveAvailabilityService(KoochDbContext dbContext) : IEffectiveAvailabilityService
{
    public async Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(
        IReadOnlyCollection<int> roomTypeIds,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int? excludedReservationId = null,
        CancellationToken cancellationToken = default)
    {
        if (checkInDate >= checkOutDate)
        {
            throw new ArgumentException("Invalid availability date range.");
        }

        var ids = roomTypeIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, EffectiveRoomTypeAvailability>();
        }

        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => ids.Contains(roomType.Id))
            .Select(roomType => new { roomType.Id, roomType.TotalInventory })
            .ToDictionaryAsync(roomType => roomType.Id, cancellationToken);
        var availabilityRows = await dbContext.Availabilities.AsNoTracking()
            .Where(availability =>
                ids.Contains(availability.RoomTypeId) &&
                availability.Date >= checkInDate &&
                availability.Date < checkOutDate)
            .ToDictionaryAsync(availability => (availability.RoomTypeId, availability.Date), cancellationToken);
        var consumingReservations = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                ids.Contains(reservation.RoomTypeId) &&
                (!excludedReservationId.HasValue || reservation.Id != excludedReservationId.Value) &&
                reservation.CheckInDate < checkOutDate &&
                reservation.CheckOutDate > checkInDate &&
                (reservation.Status == ReservationStatus.Confirmed ||
                 reservation.Status == ReservationStatus.Paid))
            .Select(reservation => new
            {
                reservation.RoomTypeId,
                reservation.RoomId,
                reservation.CheckInDate,
                reservation.CheckOutDate
            })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<int, EffectiveRoomTypeAvailability>();
        foreach (var roomType in roomTypes.Values)
        {
            var nights = new Dictionary<DateOnly, EffectiveAvailabilityNight>();
            for (var date = checkInDate; date < checkOutDate; date = date.AddDays(1))
            {
                availabilityRows.TryGetValue((roomType.Id, date), out var configured);
                var configuredCapacity = configured?.AvailableCount ?? Math.Max(0, roomType.TotalInventory);
                var configuredStatus = configured?.Status ??
                                       (configuredCapacity > 0
                                           ? AvailabilityStatus.Available
                                           : AvailabilityStatus.Unavailable);
                var claimedCapacity = consumingReservations.Count(reservation =>
                    reservation.RoomTypeId == roomType.Id &&
                    reservation.CheckInDate <= date &&
                    reservation.CheckOutDate > date);
                var remainingCapacity = Math.Max(0, configuredCapacity - claimedCapacity);

                nights[date] = new EffectiveAvailabilityNight
                {
                    Date = date,
                    ConfiguredCapacity = configuredCapacity,
                    ClaimedCapacity = claimedCapacity,
                    RemainingCapacity = remainingCapacity,
                    ConfiguredStatus = configuredStatus,
                    EffectiveStatus = remainingCapacity == 0
                        ? AvailabilityStatus.Unavailable
                        : configuredStatus,
                    IsClosed = configured?.IsClosed == true
                };
            }

            result[roomType.Id] = new EffectiveRoomTypeAvailability
            {
                RoomTypeId = roomType.Id,
                Nights = nights,
                ClaimedRoomIds = consumingReservations
                    .Where(reservation => reservation.RoomTypeId == roomType.Id && reservation.RoomId.HasValue)
                    .Select(reservation => reservation.RoomId!.Value)
                    .ToHashSet()
            };
        }

        return result;
    }
}
