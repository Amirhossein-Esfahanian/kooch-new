using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationAvailabilityService(KoochDbContext dbContext) : IReservationAvailabilityService
{
    public async Task<ReservationAvailabilityResult> GetAvailabilityAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        CancellationToken cancellationToken = default)
    {
        if (checkInDate >= checkOutDate || roomCount <= 0)
        {
            throw new ArgumentException("Invalid reservation date range.");
        }

        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        if (property.Status is PropertyStatus.Rejected or PropertyStatus.Suspended)
        {
            throw new InvalidOperationException("Property is not available for reservations.");
        }

        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(item =>
                    item.Id == roomTypeId &&
                    item.PropertyId == propertyId &&
                    item.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        var dates = GetReservationNights(checkInDate, checkOutDate).ToList();
        var availabilityRows = await dbContext.Availabilities.AsNoTracking()
            .Where(item =>
                item.RoomTypeId == roomTypeId &&
                item.Date >= checkInDate &&
                item.Date < checkOutDate)
            .ToDictionaryAsync(item => item.Date, cancellationToken);

        var nights = dates.Select(date =>
        {
            availabilityRows.TryGetValue(date, out var availability);
            return GetNightAvailability(roomType, availability, date);
        }).ToList();

        return new ReservationAvailabilityResult { Nights = nights };
    }

    public async Task ValidateAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        CancellationToken cancellationToken = default)
    {
        var availability = await GetAvailabilityAsync(
            propertyId,
            roomTypeId,
            checkInDate,
            checkOutDate,
            roomCount,
            cancellationToken);

        foreach (var night in availability.Nights)
        {
            ValidateAvailableNight(night, roomCount);
        }
    }

    private static IEnumerable<DateOnly> GetReservationNights(DateOnly checkInDate, DateOnly checkOutDate)
    {
        for (var date = checkInDate; date < checkOutDate; date = date.AddDays(1))
        {
            yield return date;
        }
    }

    private static ReservationNightAvailability GetNightAvailability(
        RoomType roomType,
        Availability? availability,
        DateOnly date)
    {
        var status = availability?.Status ??
                     (roomType.TotalInventory > 0 ? AvailabilityStatus.Available : AvailabilityStatus.Unavailable);
        var capacity = availability?.AvailableCount ?? Math.Max(0, roomType.TotalInventory);

        return new ReservationNightAvailability
        {
            Date = date,
            Status = status,
            AvailableCount = capacity,
            IsClosed = availability?.IsClosed == true
        };
    }

    private static void ValidateAvailableNight(ReservationNightAvailability night, int roomCount)
    {
        if (night.Status == AvailabilityStatus.OnRequest)
        {
            throw new InvalidOperationException("Selected dates require approval.");
        }

        if (night.Status == AvailabilityStatus.Unavailable || night.IsClosed)
        {
            throw new InvalidOperationException("Room type is unavailable for the selected dates.");
        }

        if (night.Status != AvailabilityStatus.Available)
        {
            throw new InvalidOperationException("Room type is unavailable for the selected dates.");
        }

        if (night.AvailableCount < roomCount)
        {
            throw new InvalidOperationException("Not enough capacity for the selected dates.");
        }
    }
}
