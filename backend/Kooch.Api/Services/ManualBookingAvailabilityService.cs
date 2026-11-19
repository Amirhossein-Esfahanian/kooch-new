using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ManualBookingAvailabilityService(KoochDbContext db,
    IEffectiveAvailabilityService availability, IReservationPricingService pricing)
{
    public async Task<ManualBookingAvailabilityResponse> GetAsync(int propertyId,
        DateOnly checkIn, DateOnly checkOut, PricingGuestType guestType, CancellationToken ct = default)
    {
        if (checkIn >= checkOut || !Enum.IsDefined(guestType))
            throw new ArgumentException("Invalid stay dates or guest type.");
        if (!await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct))
            throw new KeyNotFoundException("Property not found.");
        var types = await db.RoomTypes.AsNoTracking().Include(t => t.Rooms.Where(r => r.IsActive))
            .Where(t => t.PropertyId == propertyId && t.IsActive)
            .OrderBy(t => t.Name).ThenBy(t => t.Id).ToListAsync(ct);
        var ranges = await availability.GetRangeAsync(types.Select(t => t.Id).ToArray(), checkIn, checkOut,
            cancellationToken: ct);
        var options = new List<ManualBookingRoomTypeOption>();
        var excluded = new List<ManualBookingExcludedOption>();
        foreach (var type in types)
        {
            if (type.TotalInventory <= 0 || !ranges.TryGetValue(type.Id, out var range) || !range.HasCapacityForFullRange(1))
            {
                excluded.Add(new(type.Id, type.Name, ManualBookingExclusionReason.NoAvailability, []));
                continue;
            }
            if (type.MaxAdults + (type.AllowExtraGuest ? type.MaxExtraGuests : 0) < 1)
            {
                excluded.Add(new(type.Id, type.Name, ManualBookingExclusionReason.GuestCapacityExceeded, []));
                continue;
            }
            try
            {
                // Validate nightly base pricing before promotions; a free stay is not a missing price.
                await pricing.PreviewManualCreationPriceAsync(new()
                {
                    PropertyId = propertyId, RoomTypeId = type.Id, CheckInDate = checkIn, CheckOutDate = checkOut,
                    GuestType = guestType, Adults = 1, Children = 0, ChildAges = [], RoomCount = 1
                }, ct);
            }
            catch (IncompleteDailyPricingException error)
            {
                excluded.Add(new(type.Id, type.Name, ManualBookingExclusionReason.MissingNightlyPricing, error.UnavailableDates));
                continue;
            }
            var count = range.Nights.Values.Min(n => n.RemainingCapacity);
            var mode = range.Nights.Values.Any(n => n.ConfiguredStatus == AvailabilityStatus.OnRequest)
                ? ReservationBookingModeFilter.OnRequest : ReservationBookingModeFilter.Instant;
            var rooms = type.InventoryMode == InventoryMode.NamedRooms
                ? type.Rooms.Where(r => !range.ClaimedRoomIds.Contains(r.Id)).OrderBy(r => r.Name).ThenBy(r => r.Id)
                    .Take(count).Select(r => new AvailableRoomResponse
                    {
                        Id = r.Id, Name = r.Name, RoomTypeId = type.Id, Capacity = type.MaxAdults + type.MaxChildren,
                        AllowExtraGuest = type.AllowExtraGuest, MaxExtraGuests = type.MaxExtraGuests, BookingMode = mode
                    }).ToArray() : [];
            if (type.InventoryMode == InventoryMode.NamedRooms && rooms.Length == 0)
            {
                excluded.Add(new(type.Id, type.Name, ManualBookingExclusionReason.NoEligibleNamedRooms, []));
                continue;
            }
            options.Add(new()
            {
                RoomTypeId = type.Id, Name = type.Name, InventoryMode = type.InventoryMode,
                AvailableCount = type.InventoryMode == InventoryMode.NamedRooms ? rooms.Length : count,
                BaseCapacity = type.MaxAdults,
                MaxExtraGuests = type.AllowExtraGuest ? type.MaxExtraGuests : 0,
                BookingMode = mode, Rooms = rooms
            });
        }
        return new() { Options = options, Excluded = excluded };
    }
}
