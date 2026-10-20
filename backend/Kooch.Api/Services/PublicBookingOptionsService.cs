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
    IReservationPricingService pricingService,
    IChildPricingRuleResolver childPricingRuleResolver,
    IPropertySameNightBookingPolicyService sameNightPolicyService) : IPublicBookingOptionsService
{
    public async Task<PublicBookingCandidatesResponse> GetCandidatesAsync(
        string slug,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int rooms,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(checkInDate, checkOutDate, adults, children, childAges);
        if (rooms <= 1 || adults < rooms)
            throw new ArgumentException(
                "Multi-room discovery requires at least two rooms and one adult per room.", nameof(rooms));

        // Eligibility is checked for one adult in each offer. The stay-level party is
        // allocated and priced only after the selected combination reaches booking-quote.
        var baseline = await GetAsync(slug, checkInDate, checkOutDate, 1, 0, [], cancellationToken);
        return new PublicBookingCandidatesResponse
        {
            PropertyId = baseline.PropertyId,
            CheckInDate = checkInDate,
            CheckOutDate = checkOutDate,
            Rooms = rooms,
            Adults = adults,
            ChildAges = childAges.ToArray(),
            RoomTypes = baseline.RoomTypes.Select(option => new PublicBookingRoomTypeCandidate
            {
                RoomTypeId = option.RoomTypeId,
                Name = option.Name,
                RoomKind = option.RoomKind,
                InventoryMode = option.InventoryMode,
                AvailableCount = option.AvailableCount,
                BookingMode = option.BookingMode,
                MaxAdults = option.MaxAdults,
                MaxChildren = option.MaxChildren,
                AllowExtraGuest = option.AllowExtraGuest,
                MaxExtraGuests = option.MaxExtraGuests,
                DefaultMealPlanName = option.DefaultMealPlanName,
                DefaultMealPlanSlug = option.DefaultMealPlanSlug,
                Rooms = option.Rooms,
                RatePlans = option.RatePlans.Select(plan => new PublicBookingRatePlanCandidate
                {
                    RatePlanId = plan.RatePlanId,
                    Name = plan.Name,
                    MealPlanName = plan.MealPlanName,
                    MealPlanSlug = plan.MealPlanSlug,
                    MinimumNights = plan.MinimumNights
                }).ToArray()
            }).ToArray()
        };
    }

    public async Task<PublicBookingQuoteResponse> QuoteAsync(
        string slug,
        PublicBookingQuoteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.CheckInDate >= request.CheckOutDate || request.Adults <= 0 ||
            request.ChildAges is null || request.ChildAges.Any(age => age is < 0 or > 17) ||
            request.Selections is null || request.Selections.Count == 0 ||
            request.Selections.Any(selection => selection is null || selection.RoomTypeId <= 0 ||
                selection.Quantity <= 0 || selection.RatePlanId is <= 0) ||
            request.Selections.Sum(selection => (long)selection.Quantity) > int.MaxValue)
            throw new ArgumentException("Invalid booking quote request.", nameof(request));

        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        var property = await dbContext.Properties.AsNoTracking().SingleOrDefaultAsync(
            item => item.Slug == normalizedSlug && item.Status == PropertyStatus.Approved,
            cancellationToken) ?? throw new KeyNotFoundException("Property not found.");
        var roomTypeIds = request.Selections.Select(selection => selection.RoomTypeId).Distinct().ToArray();
        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == property.Id && roomType.IsActive &&
                roomTypeIds.Contains(roomType.Id))
            .ToDictionaryAsync(roomType => roomType.Id, cancellationToken);
        if (roomTypes.Count != roomTypeIds.Length)
            throw new ArgumentException("A selected room type is not available.", nameof(request));

        var globalChildRules = await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken);
        var rules = ChildOccupancyRules.FromResolved(childPricingRuleResolver.Resolve(
            property.FreeChildAgeLimit, property.MaxFreeChildren, property.ChildPrice, globalChildRules));
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypeIds, request.CheckInDate, request.CheckOutDate,
            cancellationToken: cancellationToken);
        var sameNightPolicy = sameNightPolicyService.Evaluate(property, request.CheckInDate);
        var modes = new Dictionary<int, ReservationBookingModeFilter>();
        foreach (var group in request.Selections.GroupBy(selection => selection.RoomTypeId))
        {
            var quantity = group.Sum(selection => (long)selection.Quantity);
            if (!availability.TryGetValue(group.Key, out var effective) ||
                quantity > int.MaxValue || !effective.HasCapacityForFullRange((int)quantity))
                throw new InvalidOperationException("The selected rooms are no longer available.");

            var status = effective.Nights.Values.Any(night => night.ConfiguredStatus == AvailabilityStatus.OnRequest)
                ? AvailabilityStatus.OnRequest : AvailabilityStatus.Available;
            var decision = PublicBookingModeComposer.Compose(
                new PublicBookingAvailability(status,
                    effective.Nights.Values.Any(night => night.IsClosed), true), sameNightPolicy);
            if (decision.Status == AvailabilityStatus.Unavailable)
                throw new InvalidOperationException("The selected rooms are no longer available.");
            modes[group.Key] = decision.Status == AvailabilityStatus.OnRequest
                ? ReservationBookingModeFilter.OnRequest : ReservationBookingModeFilter.Instant;
        }
        if (modes.Values.Distinct().Skip(1).Any())
            throw new InvalidOperationException(
                "Instant and on-request reservations cannot be combined in one booking session.");

        var selections = request.Selections.Select(selection =>
        {
            var roomType = roomTypes[selection.RoomTypeId];
            return new GuestRoomTypeSelection(roomType.Id,
                new RoomTypeOccupancyCapacity(roomType.MaxAdults, roomType.MaxChildren,
                    roomType.AllowExtraGuest, roomType.MaxExtraGuests), selection.Quantity);
        }).ToArray();
        var allocation = GuestRoomAllocator.Allocate(rules, request.Adults, request.ChildAges, selections);
        if (!allocation.IsValid || allocation.Rooms.Any(room => room.Adults <= 0))
            throw new InvalidOperationException(
                "The stay-level guests cannot be accommodated in the selected rooms.");

        var selectedRatePlans = request.Selections
            .SelectMany(selection => Enumerable.Repeat(selection.RatePlanId, selection.Quantity))
            .ToArray();
        var rooms = new List<PublicBookingQuotedRoom>(allocation.Rooms.Count);
        string? currency = null;
        decimal total = 0;
        foreach (var room in allocation.Rooms)
        {
            var ratePlanId = selectedRatePlans[room.SelectedRoomIndex];
            var price = await pricingService.PreviewPublicBookingPriceAsync(
                new ReservationPricePreviewRequest
                {
                    PropertyId = property.Id,
                    RoomTypeId = room.RoomTypeId,
                    RatePlanId = ratePlanId,
                    CheckInDate = request.CheckInDate,
                    CheckOutDate = request.CheckOutDate,
                    Adults = room.Adults,
                    Children = room.ChildAges.Count,
                    ChildAges = room.ChildAges,
                    RoomCount = 1,
                    GuestType = PricingGuestType.Iranian
                }, cancellationToken);
            if (price.PropertyId != property.Id || price.RoomTypeId != room.RoomTypeId)
                throw new InvalidOperationException("Pricing result does not match the selected room.");
            var roomCurrency = price.Currency?.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(roomCurrency) || roomCurrency.Length > 3)
                throw new InvalidOperationException("Pricing returned an invalid currency.");
            if (currency is not null && currency != roomCurrency)
                throw new InvalidOperationException("All rooms in a booking quote must use the same currency.");
            currency = roomCurrency;
            total = checked(total + price.FinalAmount);
            rooms.Add(new PublicBookingQuotedRoom
            {
                SelectedRoomIndex = room.SelectedRoomIndex,
                RoomTypeId = room.RoomTypeId,
                RatePlanId = ratePlanId,
                Adults = room.Adults,
                ChildAges = room.ChildAges,
                BookingMode = modes[room.RoomTypeId],
                FinalAmount = price.FinalAmount,
                Currency = roomCurrency
            });
        }

        return new PublicBookingQuoteResponse
        {
            PropertyId = property.Id,
            CheckInDate = request.CheckInDate,
            CheckOutDate = request.CheckOutDate,
            Adults = request.Adults,
            ChildAges = request.ChildAges.ToArray(),
            Rooms = rooms,
            TotalAmount = total,
            Currency = currency!
        };
    }

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
        var sameNightPolicy = sameNightPolicyService.Evaluate(property, checkInDate);

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
        var globalChildRules = await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken);
        var occupancyRules = ChildOccupancyRules.FromResolved(childPricingRuleResolver.Resolve(
            property.FreeChildAgeLimit, property.MaxFreeChildren, property.ChildPrice, globalChildRules));
        foreach (var roomType in roomTypes)
        {
            if (!ChildOccupancyEvaluator.Evaluate(occupancyRules,
                new RoomTypeOccupancyCapacity(roomType.MaxAdults, roomType.MaxChildren,
                    roomType.AllowExtraGuest, roomType.MaxExtraGuests),
                adults, childAges, roomCount: 1).IsEligible)
            {
                unavailableRoomTypes.Add(Unavailable(roomType, PublicBookingUnavailableReason.GuestCapacityExceeded));
                continue;
            }

            if (!availability.TryGetValue(roomType.Id, out var effective))
            {
                unavailableRoomTypes.Add(Unavailable(roomType, PublicBookingUnavailableReason.InsufficientAvailability));
                continue;
            }

            var hasCapacity = effective.HasCapacityForFullRange(1);
            var existingStatus = !hasCapacity
                ? AvailabilityStatus.Unavailable
                : effective.Nights.Values.Any(night => night.ConfiguredStatus == AvailabilityStatus.OnRequest)
                    ? AvailabilityStatus.OnRequest
                    : AvailabilityStatus.Available;
            var decision = PublicBookingModeComposer.Compose(
                new PublicBookingAvailability(existingStatus,
                    effective.Nights.Values.Any(night => night.IsClosed), hasCapacity),
                sameNightPolicy);
            if (decision.Status == AvailabilityStatus.Unavailable)
            {
                unavailableRoomTypes.Add(Unavailable(roomType,
                    decision.Reason == PublicBookingDecisionReason.SameNightFinalCutoff
                        ? PublicBookingUnavailableReason.SameNightFinalCutoff
                        : PublicBookingUnavailableReason.InsufficientAvailability));
                continue;
            }

            PublicBookingRoomTypeOption option;
            try
            {
                option = await BuildOptionAsync(
                    property,
                    roomType,
                    effective,
                    decision,
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
            childAges.Any(age => age is < 0 or > 17))
        {
            throw new ArgumentException(nameof(PublicBookingOptionsResponse));
        }
    }

    private async Task<PublicBookingRoomTypeOption> BuildOptionAsync(
        Property property,
        RoomType roomType,
        EffectiveRoomTypeAvailability availability,
        PublicBookingDecision decision,
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
        var bookingMode = decision.Status == AvailabilityStatus.OnRequest
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
            BookingDecisionReason = decision.Reason,
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
