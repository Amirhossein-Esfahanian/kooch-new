using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PublicBookingOptionsService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    IReservationPricingService pricingService) : IPublicBookingOptionsService
{
    public async Task<PublicBookingOptionsResponse> GetAsync(
        string slug,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(checkInDate, checkOutDate, adults, children, childAges);
        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        var property = await dbContext.Properties.AsNoTracking()
            .Include(item => item.RoomTypes.Where(roomType => roomType.IsActive))
                .ThenInclude(roomType => roomType.Rooms.Where(room => room.IsActive))
            .SingleOrDefaultAsync(
                item => item.Slug == normalizedSlug &&
                        item.Status == PropertyStatus.Approved,
                cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var roomTypes = property.RoomTypes
            .Where(roomType => CanAccommodate(roomType, adults, children))
            .OrderBy(roomType => roomType.Name)
            .ToArray();
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypes.Select(roomType => roomType.Id).ToArray(),
            checkInDate,
            checkOutDate,
            cancellationToken: cancellationToken);
        var options = new List<PublicBookingRoomTypeOption>();
        foreach (var roomType in roomTypes)
        {
            if (!availability.TryGetValue(roomType.Id, out var effective) ||
                !effective.HasCapacityForFullRange(1))
            {
                continue;
            }

            var option = await BuildOptionAsync(
                property.Id,
                roomType,
                effective,
                checkInDate,
                checkOutDate,
                adults,
                children,
                childAges,
                cancellationToken);
            if (option.AvailableCount > 0)
            {
                options.Add(option);
            }
        }

        return new PublicBookingOptionsResponse
        {
            PropertyId = property.Id,
            PropertyName = property.Name,
            PropertySlug = property.Slug,
            CheckInDate = checkInDate,
            CheckOutDate = checkOutDate,
            Adults = adults,
            Children = children,
            ChildAges = childAges.ToArray(),
            RoomTypes = options
        };
    }

    private static bool CanAccommodate(RoomType roomType, int adults, int children)
    {
        var maximumAdults = roomType.MaxAdults +
                            (roomType.AllowExtraGuest ? roomType.MaxExtraGuests : 0);
        return adults <= maximumAdults && children <= roomType.MaxChildren;
    }

    private static void ValidateRequest(
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges)
    {
        ArgumentNullException.ThrowIfNull(childAges);
        if (checkInDate >= checkOutDate ||
            adults <= 0 ||
            children < 0 ||
            childAges.Count != children ||
            childAges.Any(age => age is < 1 or > 120))
        {
            throw new ArgumentException(nameof(PublicBookingOptionsResponse));
        }
    }

    private async Task<PublicBookingRoomTypeOption> BuildOptionAsync(
        int propertyId,
        RoomType roomType,
        EffectiveRoomTypeAvailability availability,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken)
    {
        var price = await pricingService.PreviewReservationPriceAsync(
            new ReservationPricePreviewRequest
            {
                PropertyId = propertyId,
                RoomTypeId = roomType.Id,
                CheckInDate = checkInDate,
                CheckOutDate = checkOutDate,
                Adults = adults,
                Children = children,
                ChildAges = childAges,
                RoomCount = 1,
                GuestType = PricingGuestType.Iranian
            },
            cancellationToken);
        var availableCount = availability.Nights.Values
            .Min(night => night.RemainingCapacity);
        var bookingMode = availability.Nights.Values.Any(night =>
                night.ConfiguredStatus == AvailabilityStatus.OnRequest)
            ? ReservationBookingModeFilter.OnRequest
            : ReservationBookingModeFilter.Instant;
        var availableNamedRooms = roomType.Rooms
            .Where(room => !availability.ClaimedRoomIds.Contains(room.Id))
            .OrderBy(room => room.Name)
            .ToArray();
        if (roomType.InventoryMode == InventoryMode.NamedRooms)
        {
            availableCount = Math.Min(availableCount, availableNamedRooms.Length);
        }

        var rooms = roomType.InventoryMode == InventoryMode.NamedRooms
            ? availableNamedRooms
                .Take(availableCount)
                .Select(room => new PublicBookingRoomOption
                {
                    RoomId = room.Id,
                    Name = room.Name
                })
                .ToArray()
            : [];

        return new PublicBookingRoomTypeOption
        {
            RoomTypeId = roomType.Id,
            Name = roomType.Name,
            EnglishName = roomType.EnglishName,
            InventoryMode = roomType.InventoryMode,
            AvailableCount = availableCount,
            BookingMode = bookingMode,
            MaxAdults = roomType.MaxAdults,
            MaxChildren = roomType.MaxChildren,
            AllowExtraGuest = roomType.AllowExtraGuest,
            MaxExtraGuests = roomType.MaxExtraGuests,
            NightsCount = price.NightsCount,
            FinalAmount = price.FinalAmount,
            Currency = price.Currency,
            Rooms = rooms
        };
    }
}
