using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationAvailabilityService(KoochDbContext dbContext) : IReservationAvailabilityService
{
    public async Task<IReadOnlyList<AvailableRoomResponse>> GetAvailableRoomsAsync(
        int propertyId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        CancellationToken cancellationToken = default)
    {
        if (checkInDate >= checkOutDate)
        {
            throw new ArgumentException("Invalid reservation date range.");
        }

        var propertyExists = await dbContext.Properties.AsNoTracking()
            .AnyAsync(property => property.Id == propertyId, cancellationToken);
        if (!propertyExists)
        {
            throw new KeyNotFoundException("Property not found.");
        }

        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType =>
                roomType.PropertyId == propertyId &&
                roomType.IsActive &&
                roomType.TotalInventory > 0 &&
                roomType.MaxAdults + roomType.MaxChildren > 0)
            .Select(roomType => new
            {
                roomType.Id,
                roomType.MaxAdults,
                roomType.MaxChildren,
                roomType.AllowExtraGuest,
                roomType.MaxExtraGuests,
                roomType.TotalInventory,
                Rooms = roomType.Rooms
                    .Where(room => room.IsActive)
                    .Select(room => new { room.Id, room.Name })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var availability = await dbContext.Availabilities.AsNoTracking()
            .Where(item =>
                roomTypeIds.Contains(item.RoomTypeId) &&
                item.Date >= checkInDate &&
                item.Date < checkOutDate)
            .ToListAsync(cancellationToken);

        var claimedReservations = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                reservation.PropertyId == propertyId &&
                reservation.CheckInDate < checkOutDate &&
                reservation.CheckOutDate > checkInDate &&
                (reservation.Status == ReservationStatus.Confirmed ||
                 reservation.Status == ReservationStatus.Paid) &&
                reservation.Payments.Any(payment => payment.Status == PaymentStatus.Successful))
            .Select(reservation => new
            {
                reservation.RoomTypeId,
                reservation.RoomId,
                reservation.CheckInDate,
                reservation.CheckOutDate
            })
            .ToListAsync(cancellationToken);
        var unavailableRoomIds = claimedReservations
            .Where(item => item.RoomId.HasValue)
            .Select(item => item.RoomId!.Value)
            .ToHashSet();

        var result = new List<AvailableRoomResponse>();
        foreach (var roomType in roomTypes)
        {
            var rows = availability.Where(item => item.RoomTypeId == roomType.Id).ToList();
            if (rows.Any(item => item.IsClosed || item.Status == AvailabilityStatus.Unavailable || item.AvailableCount <= 0))
            {
                continue;
            }

            var minimumInventory = GetReservationNights(checkInDate, checkOutDate)
                .Min(date =>
                {
                    var configuredCount = rows.FirstOrDefault(item => item.Date == date)?.AvailableCount
                                          ?? roomType.TotalInventory;
                    var claimedCount = claimedReservations.Count(item =>
                        item.RoomTypeId == roomType.Id &&
                        item.CheckInDate <= date &&
                        item.CheckOutDate > date);
                    return Math.Max(0, configuredCount - claimedCount);
                });
            var bookingMode = rows.Any(item => item.Status == AvailabilityStatus.OnRequest)
                ? ReservationBookingModeFilter.OnRequest
                : ReservationBookingModeFilter.Instant;

            var availableRooms = roomType.Rooms
                .Where(room => !unavailableRoomIds.Contains(room.Id))
                .Take(minimumInventory);
            result.AddRange(availableRooms.Select(room => new AvailableRoomResponse
            {
                Id = room.Id,
                RoomTypeId = roomType.Id,
                Name = room.Name,
                Capacity = roomType.MaxAdults + roomType.MaxChildren,
                AllowExtraGuest = roomType.AllowExtraGuest,
                MaxExtraGuests = roomType.MaxExtraGuests,
                BookingMode = bookingMode
            }));
        }

        return result.OrderBy(room => room.RoomTypeId).ThenBy(room => room.Name).ToList();
    }

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
        var claimedReservations = await dbContext.Reservations.AsNoTracking()
            .Where(item =>
                item.RoomTypeId == roomTypeId &&
                item.CheckInDate < checkOutDate &&
                item.CheckOutDate > checkInDate &&
                (item.Status == ReservationStatus.Confirmed || item.Status == ReservationStatus.Paid) &&
                item.Payments.Any(payment => payment.Status == PaymentStatus.Successful))
            .Select(item => new { item.CheckInDate, item.CheckOutDate })
            .ToListAsync(cancellationToken);

        var nights = dates.Select(date =>
        {
            availabilityRows.TryGetValue(date, out var availability);
            var claimedCount = claimedReservations.Count(item =>
                item.CheckInDate <= date && item.CheckOutDate > date);
            return GetNightAvailability(roomType, availability, date, claimedCount);
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
        DateOnly date,
        int claimedCount)
    {
        var status = availability?.Status ??
                     (roomType.TotalInventory > 0 ? AvailabilityStatus.Available : AvailabilityStatus.Unavailable);
        var capacity = Math.Max(
            0,
            (availability?.AvailableCount ?? Math.Max(0, roomType.TotalInventory)) - claimedCount);
        if (capacity == 0 && status == AvailabilityStatus.Available)
        {
            status = AvailabilityStatus.Unavailable;
        }

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
