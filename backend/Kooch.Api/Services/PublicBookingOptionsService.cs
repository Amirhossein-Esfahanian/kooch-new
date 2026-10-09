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
            .Include(item => item.DefaultMealPlan)
            .Include(item => item.RoomTypes.Where(roomType => roomType.IsActive))
                .ThenInclude(roomType => roomType.Rooms.Where(room => room.IsActive))
            .Include(item => item.RoomTypes.Where(roomType => roomType.IsActive))
                .ThenInclude(roomType => roomType.DefaultMealPlan)
            .SingleOrDefaultAsync(
                item => item.Slug == normalizedSlug &&
                        item.Status == PropertyStatus.Approved,
                cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var roomTypes = property.RoomTypes
            .OrderBy(roomType => roomType.Name)
            .ToArray();
        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var ratePlansByRoomType = await dbContext.RatePlans.AsNoTracking()
            .Include(plan => plan.MealPlan)
            .Where(plan => roomTypeIds.Contains(plan.RoomTypeId) && plan.IsActive &&
                plan.PriceModifierType == PriceModifierType.FixedAmount)
            .OrderBy(plan => plan.Name).ThenBy(plan => plan.Id)
            .ToListAsync(cancellationToken);
        var eligiblePlans = ratePlansByRoomType
            .Where(plan => !plan.MealPlanId.HasValue || plan.MealPlan is not null)
            .Where(plan => !plan.MinimumNights.HasValue ||
                plan.MinimumNights.Value > 0 &&
                checkOutDate.DayNumber - checkInDate.DayNumber >= plan.MinimumNights.Value)
            .GroupBy(plan => plan.RoomTypeId)
            .ToDictionary(group => group.Key, group => group.ToArray());
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypeIds,
            checkInDate,
            checkOutDate,
            cancellationToken: cancellationToken);
        var options = new List<PublicBookingRoomTypeOption>();
        var unavailableRoomTypes = new List<PublicBookingUnavailableRoomType>();
        foreach (var roomType in roomTypes)
        {
            if (!CanAccommodate(roomType, adults, children))
            {
                unavailableRoomTypes.Add(Unavailable(roomType, PublicBookingUnavailableReason.GuestCapacityExceeded));
                continue;
            }

            if (!availability.TryGetValue(roomType.Id, out var effective) ||
                !effective.HasCapacityForFullRange(1))
            {
                unavailableRoomTypes.Add(Unavailable(roomType, PublicBookingUnavailableReason.InsufficientAvailability));
                continue;
            }

            PublicBookingRoomTypeOption option;
            try
            {
                option = await BuildOptionAsync(
                    property,
                    roomType,
                    effective,
                    checkInDate,
                    checkOutDate,
                    adults,
                    children,
                    childAges,
                    cancellationToken);
            }
            catch (IncompleteDailyPricingException)
            {
                unavailableRoomTypes.Add(Unavailable(
                    roomType,
                    PublicBookingUnavailableReason.IncompleteDailyPricing));
                continue;
            }
            if (option.AvailableCount > 0)
            {
                if (eligiblePlans.TryGetValue(roomType.Id, out var plans))
                    option.RatePlans = await BuildRatePlanOptionsAsync(
                        property.Id, roomType.Id, plans, checkInDate, checkOutDate,
                        adults, children, childAges, cancellationToken);
                options.Add(option);
            }
            else
            {
                unavailableRoomTypes.Add(Unavailable(roomType, PublicBookingUnavailableReason.InsufficientAvailability));
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
            RoomTypes = options,
            UnavailableRoomTypes = unavailableRoomTypes
        };
    }

    private static PublicBookingUnavailableRoomType Unavailable(
        RoomType roomType,
        PublicBookingUnavailableReason reason) =>
        new()
        {
            RoomTypeId = roomType.Id,
            Name = roomType.Name,
            RoomKind = roomType.RoomKind,
            Reason = reason
        };

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
        Property property,
        RoomType roomType,
        EffectiveRoomTypeAvailability availability,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken)
    {
        var price = await pricingService.PreviewPublicBookingPriceAsync(
            new ReservationPricePreviewRequest
            {
                PropertyId = property.Id,
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
        var physicalRoomMetadata = roomType.Rooms
            .Where(room => !availability.ClaimedRoomIds.Contains(room.Id))
            .OrderBy(room => room.Name)
            .ToArray();
        var rooms = physicalRoomMetadata
            .Select(room => new PublicBookingRoomOption
            {
                RoomId = room.Id,
                Name = room.Name
            })
            .ToArray();
        var standardMealPlan = StandardMealPlanResolver.Resolve(roomType, property);

        return new PublicBookingRoomTypeOption
        {
            RoomTypeId = roomType.Id,
            Name = roomType.Name,
            RoomKind = roomType.RoomKind,
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
            DefaultMealPlanName = standardMealPlan?.Name,
            DefaultMealPlanSlug = standardMealPlan?.Slug,
            Rooms = rooms
        };
    }

    private async Task<IReadOnlyList<PublicBookingRatePlanOption>> BuildRatePlanOptionsAsync(
        int propertyId,
        int roomTypeId,
        IReadOnlyList<RatePlan> plans,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken)
    {
        var options = new List<PublicBookingRatePlanOption>(plans.Count);
        foreach (var plan in plans)
        {
            ReservationPricePreviewResponse price;
            try
            {
                price = await pricingService.PreviewPublicBookingPriceAsync(
                    new ReservationPricePreviewRequest
                    {
                        PropertyId = propertyId,
                        RoomTypeId = roomTypeId,
                        RatePlanId = plan.Id,
                        CheckInDate = checkInDate,
                        CheckOutDate = checkOutDate,
                        Adults = adults,
                        Children = children,
                        ChildAges = childAges,
                        RoomCount = 1,
                        GuestType = PricingGuestType.Iranian
                    }, cancellationToken);
            }
            catch (Exception error) when (error is ArgumentException or KeyNotFoundException)
            {
                // A plan can become unavailable or produce a non-positive nightly price; keep the base offer.
                continue;
            }
            options.Add(new PublicBookingRatePlanOption
            {
                RatePlanId = plan.Id,
                Name = plan.Name,
                MealPlanName = plan.MealPlan?.Name,
                MealPlanSlug = plan.MealPlan?.Slug,
                MinimumNights = plan.MinimumNights,
                FinalAmount = price.FinalAmount,
                Currency = price.Currency
            });
        }
        return options;
    }
}
