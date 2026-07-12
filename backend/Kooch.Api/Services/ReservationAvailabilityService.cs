using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationAvailabilityService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService) : IReservationAvailabilityService
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
        var effectiveAvailability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypeIds,
            checkInDate,
            checkOutDate,
            cancellationToken: cancellationToken);

        var result = new List<AvailableRoomResponse>();
        foreach (var roomType in roomTypes)
        {
            if (!effectiveAvailability.TryGetValue(roomType.Id, out var roomAvailability) ||
                !roomAvailability.HasCapacityForFullRange(1))
            {
                continue;
            }

            var minimumInventory = roomAvailability.Nights.Values.Min(night => night.RemainingCapacity);
            var bookingMode = roomAvailability.Nights.Values.Any(
                night => night.ConfiguredStatus == AvailabilityStatus.OnRequest)
                ? ReservationBookingModeFilter.OnRequest
                : ReservationBookingModeFilter.Instant;

            var availableRooms = roomType.Rooms
                .Where(room => !roomAvailability.ClaimedRoomIds.Contains(room.Id))
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

        var range = await effectiveAvailabilityService.GetRangeAsync(
            [roomTypeId],
            checkInDate,
            checkOutDate,
            cancellationToken: cancellationToken);
        var nights = range[roomTypeId].Nights.Values
            .OrderBy(night => night.Date)
            .Select(night => new ReservationNightAvailability
            {
                Date = night.Date,
                Status = night.ConfiguredStatus == AvailabilityStatus.OnRequest
                    ? AvailabilityStatus.OnRequest
                    : night.EffectiveStatus,
                AvailableCount = night.RemainingCapacity,
                IsClosed = night.IsClosed
            })
            .ToList();

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
