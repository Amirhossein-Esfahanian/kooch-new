using Kooch.Api.Data;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class PublicBookingOptionsTests
{
    [Fact]
    public async Task Options_UseEffectiveRangeAvailabilityPricingAndNamedRooms()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        Assert.Equal(1, result.PropertyId);
        Assert.Equal(2, result.RoomTypes.Count);
        var instant = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 10);
        Assert.Equal(ReservationBookingModeFilter.Instant, instant.BookingMode);
        Assert.Equal(1, instant.AvailableCount);
        Assert.Equal(20, instant.FinalAmount);
        Assert.Empty(instant.RatePlans);
        Assert.Equal(101, Assert.Single(instant.Rooms).RoomId);
        var onRequest = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 20);
        Assert.Equal(ReservationBookingModeFilter.OnRequest, onRequest.BookingMode);
        Assert.Equal(40, onRequest.FinalAmount);
        Assert.Empty(result.UnavailableRoomTypes);
    }

    [Fact]
    public async Task AvailableRoomType_ReturnsDeterministicAuthoritativelyPricedAlternatives()
    {
        await using var context = await CreatePricedContextAsync();
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Breakfast", Slug = "breakfast" });
        context.RatePlans.AddRange(
            Plan(53, "C premium", 30),
            Plan(51, "A without breakfast", -20),
            Plan(52, "B standard", 0));
        context.RatePlans.Local.Single(plan => plan.Id == 51).MealPlanId = 70;
        await context.SaveChangesAsync();

        var result = await AuthoritativeService(context).GetAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(result.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(300, room.FinalAmount);
        Assert.Equal(1, room.AvailableCount);
        Assert.Equal([51, 52, 53], room.RatePlans.Select(plan => plan.RatePlanId));
        Assert.Equal([260m, 300m, 360m], room.RatePlans.Select(plan => plan.FinalAmount));
        Assert.All(room.RatePlans, plan => Assert.Equal("IRR", plan.Currency));
        Assert.Equal("Breakfast", room.RatePlans[0].MealPlanName);
        Assert.Equal("breakfast", room.RatePlans[0].MealPlanSlug);
        Assert.DoesNotContain(result.UnavailableRoomTypes, option => option.RoomTypeId == 10);
    }

    [Fact]
    public async Task StandardOffer_ExposesDefaultMealPlanMetadataWithoutChangingPriceOrRatePlans()
    {
        await using var context = await CreatePricedContextAsync();
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Breakfast", Slug = "breakfast" });
        (await context.RoomTypes.SingleAsync(roomType => roomType.Id == 10)).DefaultMealPlanId = 70;
        await context.SaveChangesAsync();

        var result = await AuthoritativeService(context).GetAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(result.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal("Breakfast", room.DefaultMealPlanName);
        Assert.Equal("breakfast", room.DefaultMealPlanSlug);
        Assert.Equal(300m, room.FinalAmount);
        Assert.Empty(room.RatePlans);
    }

    [Theory]
    [InlineData(true, false, false, false, "Property meal")]
    [InlineData(false, true, false, false, "Room meal")]
    [InlineData(true, true, false, false, "Room meal")]
    [InlineData(false, false, false, false, null)]
    [InlineData(true, true, false, true, "Property meal")]
    [InlineData(true, false, true, false, null)]
    public async Task StandardOffer_ResolvesUsableMealPlanWithoutChangingPriceOrInventory(
        bool propertyDefault, bool roomDefault, bool deletedPropertyMeal,
        bool deletedRoomMeal, string? expectedName)
    {
        await using var context = await CreatePricedContextAsync();
        context.MealPlans.AddRange(
            new MealPlan { Id = 70, Name = "Property meal", Slug = "property-meal", IsDeleted = deletedPropertyMeal },
            new MealPlan { Id = 71, Name = "Room meal", Slug = "room-meal", IsDeleted = deletedRoomMeal });
        var property = await context.Properties.SingleAsync(item => item.Id == 1);
        property.DefaultMealPlanId = propertyDefault ? 70 : null;
        (await context.RoomTypes.SingleAsync(item => item.Id == 10)).DefaultMealPlanId = roomDefault ? 71 : null;
        await context.SaveChangesAsync();

        var result = await AuthoritativeService(context).GetAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 10);
        Assert.Equal(expectedName, room.DefaultMealPlanName);
        Assert.Equal(expectedName?.ToLowerInvariant().Replace(' ', '-'), room.DefaultMealPlanSlug);
        Assert.Equal(300m, room.FinalAmount);
        Assert.Equal(1, room.AvailableCount);
        Assert.Empty(room.RatePlans);
    }

    [Fact]
    public async Task UnsupportedOrInvalidPlans_DoNotRemoveValidBaseOffer()
    {
        await using var context = await CreatePricedContextAsync();
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Deleted", Slug = "deleted", IsDeleted = true });
        context.RatePlans.AddRange(
            Plan(51, "Non-positive", -120),
            Plan(52, "Inactive", 0, isActive: false),
            Plan(53, "Deleted", 0, isDeleted: true),
            Plan(54, "Percentage", 10, type: PriceModifierType.Percentage),
            Plan(55, "Deleted meal", 0, mealPlanId: 70),
            Plan(56, "Valid", -10));
        await context.SaveChangesAsync();

        var result = await AuthoritativeService(context).GetAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(result.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(300, room.FinalAmount);
        Assert.Equal(1, room.AvailableCount);
        var plan = Assert.Single(room.RatePlans);
        Assert.Equal(56, plan.RatePlanId);
        Assert.Equal(280, plan.FinalAmount);
    }

    [Fact]
    public async Task RatePlanMinimumNights_FiltersOnlyTheAlternativeForShortStay()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.AddRange(
            Plan(51, "Three nights", -10, minimumNights: 3),
            Plan(52, "Two nights", 0, minimumNights: 2));
        await context.SaveChangesAsync();

        var result = await AuthoritativeService(context).GetAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(result.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(300, room.FinalAmount);
        var plan = Assert.Single(room.RatePlans);
        Assert.Equal(52, plan.RatePlanId);
        Assert.Equal(2, plan.MinimumNights);
    }

    [Fact]
    public async Task NamedRoomTypeWithoutPhysicalRooms_RemainsSellable()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        context.RoomTypes.Add(RoomType(30, InventoryMode.NamedRooms, totalInventory: 1));
        await context.SaveChangesAsync();
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        var option = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 30);
        Assert.Equal(1, option.AvailableCount);
        Assert.Empty(option.Rooms);
        Assert.DoesNotContain(result.UnavailableRoomTypes, item => item.RoomTypeId == 30);
    }

    [Fact]
    public async Task InventoryModes_WithEqualSellableData_ReturnEqualCapacityWithoutRoomClamping()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        context.RoomTypes.AddRange(
            RoomType(30, InventoryMode.NamedRooms, totalInventory: 3),
            RoomType(40, InventoryMode.TypeBasedInventory, totalInventory: 3));
        context.Rooms.Add(new Room
        {
            Id = 300,
            RoomTypeId = 30,
            Name = "Optional physical room",
            IsActive = true
        });
        await context.SaveChangesAsync();
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        var named = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 30);
        var typeBased = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 40);
        Assert.Equal(3, named.AvailableCount);
        Assert.Equal(named.AvailableCount, typeBased.AvailableCount);
        Assert.Equal(300, Assert.Single(named.Rooms).RoomId);
    }

    [Fact]
    public async Task ClosedOrZeroCapacityCalendarNight_RemainsUnavailable()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        context.RoomTypes.Add(RoomType(30, InventoryMode.NamedRooms, totalInventory: 1));
        context.Availabilities.Add(new Availability
        {
            RoomTypeId = 30,
            Date = new DateOnly(2035, 2, 1),
            AvailableCount = 0,
            Status = AvailabilityStatus.Unavailable
        });
        await context.SaveChangesAsync();
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        Assert.DoesNotContain(result.RoomTypes, item => item.RoomTypeId == 30);
        Assert.Equal(
            PublicBookingUnavailableReason.InsufficientAvailability,
            Assert.Single(result.UnavailableRoomTypes, item => item.RoomTypeId == 30).Reason);
    }

    [Fact]
    public async Task IncompleteDailyPricing_ReturnsAnActionableUnavailableReason()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new IncompleteRangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        Assert.Empty(result.RoomTypes);
        Assert.All(result.UnavailableRoomTypes, unavailable =>
            Assert.Equal(PublicBookingUnavailableReason.IncompleteDailyPricing, unavailable.Reason));
    }

    [Fact]
    public void PublicController_ExposesBookingOptionsAtTheExpectedRoute()
    {
        var method = typeof(PublicPropertiesController).GetMethod(
            nameof(PublicPropertiesController.GetBookingOptions));
        Assert.NotNull(method);
        var route = Assert.Single(
            method.GetCustomAttributes(typeof(HttpGetAttribute), inherit: true)
                .Cast<HttpGetAttribute>());
        Assert.Equal("{slug}/booking-options", route.Template);
    }

    [Fact]
    public async Task PublicController_ParsesCsvChildAgesIntoOneOrderedAgeList()
    {
        var bookingOptions = new RecordingBookingOptionsService();
        var controller = new PublicPropertiesController(null!, bookingOptions, null!);

        await controller.GetBookingOptions(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            adults: 2,
            children: 2,
            childAges: "5,8",
            cancellationToken: CancellationToken.None);

        Assert.Equal([5, 8], bookingOptions.ChildAges);
        Assert.Equal(2, bookingOptions.Children);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(17)]
    public async Task BookingOptions_AcceptsPublicChildAgeBoundariesAndPricesTheRequest(int age)
    {
        await using var context = await CreatePricedContextAsync();

        var response = await AuthoritativeService(context).GetAsync(
            "public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 1, [age]);

        var option = Assert.Single(response.RoomTypes, item => item.RoomTypeId == 10);
        Assert.Equal([age], response.ChildAges);
        Assert.True(option.FinalAmount > 0);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(18)]
    public async Task BookingOptions_RejectsChildAgesOutsidePublicRange(int age)
    {
        await using var context = await CreatePricedContextAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => AuthoritativeService(context).GetAsync(
            "public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 1, [age]));
    }

    [Theory]
    [InlineData(1, "")]
    [InlineData(1, "0,17")]
    [InlineData(2, "0")]
    public async Task BookingOptions_RejectsChildAgeCountMismatch(int children, string agesCsv)
    {
        await using var context = await CreatePricedContextAsync();
        var ages = agesCsv.Length == 0 ? Array.Empty<int>() : agesCsv.Split(',').Select(int.Parse).ToArray();

        await Assert.ThrowsAsync<ArgumentException>(() => AuthoritativeService(context).GetAsync(
            "public-property", new(2035, 2, 1), new(2035, 2, 3), 1, children, ages));
    }

    [Fact]
    public async Task PublicController_MalformedChildAgeIsRejectedByBookingOptionsBoundary()
    {
        await using var context = await CreatePricedContextAsync();
        var controller = new PublicPropertiesController(
            null!, AuthoritativeService(context), null!);

        await Assert.ThrowsAsync<ArgumentException>(() => controller.GetBookingOptions(
            "public-property", new(2035, 2, 1), new(2035, 2, 3), adults: 1, children: 1,
            childAges: "not-an-age", cancellationToken: CancellationToken.None));
    }

    [Theory]
    [InlineData(2, "4", 0, false, 0, null, false)]
    [InlineData(2, "4", 1, false, 0, null, true)]
    [InlineData(2, "8", 0, false, 0, null, false)]
    [InlineData(2, "8", 1, false, 0, null, true)]
    [InlineData(2, "4,5", 1, false, 0, 1, false)]
    [InlineData(2, "4,8", 1, false, 0, 0, false)]
    [InlineData(2, "4,5", 2, false, 0, null, true)]
    [InlineData(2, "4,5", 2, false, 0, 0, true)]
    [InlineData(2, "4,5", 2, false, 0, 1, true)]
    [InlineData(1, "15", 0, false, 0, null, true)]
    [InlineData(2, "15", 0, false, 1, null, false)]
    [InlineData(2, "15", 0, true, 1, null, true)]
    [InlineData(4, "", 2, false, 0, null, false)]
    public async Task StructuralPrecheck_UsesV2AndKeepsOneRoomPricingRequest(
        int adults, string agesCsv, int maxChildren, bool allowExtra, int extra,
        int? quota, bool included)
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureChildRulesAsync(context);
        (await context.RoomTypes.SingleAsync(item => item.Id == 20)).IsActive = false;
        var room = await context.RoomTypes.SingleAsync(item => item.Id == 10);
        room.MaxChildren = maxChildren;
        room.AllowExtraGuest = allowExtra;
        room.MaxExtraGuests = extra;
        (await context.Properties.SingleAsync()).MaxFreeChildren = quota;
        await context.SaveChangesAsync();
        int[] ages = agesCsv.Length == 0 ? [] : agesCsv.Split(',').Select(int.Parse).ToArray();
        var pricing = new RecordingPricingService();
        var service = new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
            pricing, new ChildPricingRuleResolver(context), DefaultPolicy());
        var result = await service.GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 3),
            adults, ages.Length, ages);
        Assert.Equal(included ? 1 : 0, result.RoomTypes.Count);
        if (included)
        {
            var request = Assert.Single(pricing.Requests);
            Assert.Equal(1, request.RoomCount);
            Assert.Equal(adults, request.Adults);
            Assert.Equal(ages.Length, request.Children);
            Assert.Equal(ages, request.ChildAges);
            var option = Assert.Single(result.RoomTypes);
            Assert.Equal(1234, option.FinalAmount);
            Assert.Equal(1, option.AvailableCount);
            Assert.Single(option.Rooms);
        }
        else
        {
            Assert.Empty(pricing.Requests);
            Assert.Equal(PublicBookingUnavailableReason.GuestCapacityExceeded,
                Assert.Single(result.UnavailableRoomTypes).Reason);
        }
    }

    [Fact]
    public async Task V2AcceptedParty_NoLongerFailsLegacyDeclaredChildLimit()
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureChildRulesAsync(context);
        Assert.True(ChildOccupancyEvaluator.Evaluate(new(5, 6, 12, null),
            new(2, 2, false, 0), 2, [4, 5]).IsEligible);
        var response = await AuthoritativeService(context).GetAsync("public-property",
            new(2035, 2, 1), new(2035, 2, 3), 2, 2, [4, 5]);
        var option = Assert.Single(response.RoomTypes);
        Assert.Equal(10, option.RoomTypeId);
        Assert.Equal(300m, option.FinalAmount);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task ChildRateCharge_IsIncludedInStandardAndRatePlanQuotesEvenWithSpareAdultCapacity(int adults)
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureChildRulesAsync(context);
        (await context.Properties.SingleAsync()).ChildPrice = 50;
        context.RatePlans.Add(Plan(51, "Alternative", -20));
        await context.SaveChangesAsync();
        var response = await AuthoritativeService(context).GetAsync("public-property",
            new(2035, 2, 1), new(2035, 2, 3), adults, 1, [8]);
        var option = Assert.Single(response.RoomTypes);
        Assert.Equal(400m, option.FinalAmount);
        Assert.Equal(360m, Assert.Single(option.RatePlans).FinalAmount);
        Assert.Equal(1, option.AvailableCount);
    }

    [Theory]
    [InlineData(1, 19, 29, ReservationBookingModeFilter.Instant, PublicBookingDecisionReason.None)]
    [InlineData(1, 19, 30, ReservationBookingModeFilter.OnRequest, PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(1, 20, 0, ReservationBookingModeFilter.OnRequest, PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(1, 21, 30, ReservationBookingModeFilter.OnRequest, PublicBookingDecisionReason.SameNightApprovalRequired)]
    public async Task SameNightDeadline_DowngradesAvailableOfferAtTehranBoundaries(
        int utcDay, int utcHour, int utcMinute,
        ReservationBookingModeFilter expectedMode, PublicBookingDecisionReason expectedReason)
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureSameNightPolicyAsync(context);
        var service = AuthoritativeService(context, PolicyAt(utcDay, utcHour, utcMinute));

        var response = await service.GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 2), 1, 0, []);

        var room = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(expectedMode, room.BookingMode);
        Assert.Equal(expectedReason, room.BookingDecisionReason);
        Assert.Equal(1, room.AvailableCount);
        Assert.Equal(120m, room.FinalAmount);
        Assert.Equal(1, room.NightsCount);
    }

    [Theory]
    [InlineData(1, 22, 30)]
    [InlineData(1, 22, 31)]
    public async Task SameNightFinalCutoff_OmitsBookableOfferWithSpecificReason(int utcDay, int utcHour, int utcMinute)
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureSameNightPolicyAsync(context);

        var response = await AuthoritativeService(context, PolicyAt(utcDay, utcHour, utcMinute))
            .GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);

        Assert.DoesNotContain(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(PublicBookingUnavailableReason.SameNightFinalCutoff,
            Assert.Single(response.UnavailableRoomTypes, option => option.RoomTypeId == 10).Reason);
    }

    [Fact]
    public async Task FutureCheckIn_IsNotDowngradedByTodaysDeadline()
    {
        await using var context = await CreatePricedContextAsync();
        await ConfigureSameNightPolicyAsync(context);

        var response = await AuthoritativeService(context, PolicyAt(1, 20, 0))
            .GetAsync("public-property", new(2035, 2, 2), new(2035, 2, 3), 1, 0, []);

        var room = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(ReservationBookingModeFilter.Instant, room.BookingMode);
        Assert.Equal(PublicBookingDecisionReason.None, room.BookingDecisionReason);
    }

    [Theory]
    [InlineData(SameNightBookingPolicyResult.InstantEligible, true)]
    [InlineData(SameNightBookingPolicyResult.RequiresApproval, true)]
    [InlineData(SameNightBookingPolicyResult.Closed, false)]
    public async Task ExistingCalendarOnRequest_IsNeverUpgraded(
        SameNightBookingPolicyResult policy, bool bookable)
    {
        await using var context = await CreatePricedContextAsync();
        var service = new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), new CountingPolicy(policy));

        var response = await service.GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);

        if (bookable)
        {
            var room = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 20);
            Assert.Equal(ReservationBookingModeFilter.OnRequest, room.BookingMode);
            Assert.Equal(PublicBookingDecisionReason.ExistingOnRequest, room.BookingDecisionReason);
            Assert.Equal(2, room.AvailableCount);
        }
        else
        {
            Assert.DoesNotContain(response.RoomTypes, option => option.RoomTypeId == 20);
            Assert.Equal(PublicBookingUnavailableReason.SameNightFinalCutoff,
                Assert.Single(response.UnavailableRoomTypes, option => option.RoomTypeId == 20).Reason);
        }
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task CalendarClosureAndConsumedCapacity_RemainUnavailableUnderApprovalPolicy(
        bool calendarClosed, bool consumedCapacity)
    {
        await using var context = await CreatePricedContextAsync();
        if (calendarClosed)
            context.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = new(2035, 2, 2), AvailableCount = 2,
                Status = AvailabilityStatus.Available, IsClosed = true
            });
        if (consumedCapacity)
            (await context.RoomTypes.SingleAsync(roomType => roomType.Id == 10)).TotalInventory = 1;
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context,
            new CountingPolicy(SameNightBookingPolicyResult.RequiresApproval))
            .GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);

        Assert.DoesNotContain(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(PublicBookingUnavailableReason.InsufficientAvailability,
            Assert.Single(response.UnavailableRoomTypes, option => option.RoomTypeId == 10).Reason);
    }

    [Fact]
    public async Task PolicyIsEvaluatedOnceAndSharedByStandardAndRatePlanOffers()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.Add(Plan(51, "Two-night alternative", -20, minimumNights: 2));
        await context.SaveChangesAsync();
        var policy = new CountingPolicy(SameNightBookingPolicyResult.RequiresApproval);

        var response = await AuthoritativeService(context, policy).GetAsync(
            "public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);

        Assert.Equal(1, policy.CallCount);
        Assert.Equal(1, policy.PropertyId);
        Assert.Equal(new DateOnly(2035, 2, 1), policy.CheckIn);
        var room = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(ReservationBookingModeFilter.OnRequest, room.BookingMode);
        Assert.Equal(PublicBookingDecisionReason.SameNightApprovalRequired, room.BookingDecisionReason);
        Assert.Equal(1, room.AvailableCount);
        Assert.Equal(300m, room.FinalAmount);
        var plan = Assert.Single(room.RatePlans);
        Assert.Equal(51, plan.RatePlanId);
        Assert.Equal(2, plan.MinimumNights);
        Assert.Equal(260m, plan.FinalAmount);
    }

    [Fact]
    public async Task UnconfiguredProperty_PreservesExistingAvailableAndOnRequestModes()
    {
        await using var context = await CreatePricedContextAsync();
        var service = new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
            new RangePricingService(), new ChildPricingRuleResolver(context), DefaultPolicy());

        var response = await service.GetAsync("public-property", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);

        Assert.Equal(ReservationBookingModeFilter.Instant,
            Assert.Single(response.RoomTypes, option => option.RoomTypeId == 10).BookingMode);
        var onRequest = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 20);
        Assert.Equal(ReservationBookingModeFilter.OnRequest, onRequest.BookingMode);
        Assert.Equal(PublicBookingDecisionReason.ExistingOnRequest, onRequest.BookingDecisionReason);
    }

    private static async Task ConfigureSameNightPolicyAsync(KoochDbContext context)
    {
        var property = await context.Properties.SingleAsync();
        property.SameNightInstantBookingTime = new TimeOnly(23, 0);
        property.SameNightInstantBookingDayOffset = 0;
        property.SameNightFinalBookingTime = new TimeOnly(2, 0);
        property.SameNightFinalBookingDayOffset = 1;
        await context.SaveChangesAsync();
    }

    private static IPropertySameNightBookingPolicyService PolicyAt(int day, int hour, int minute) =>
        new PropertySameNightBookingPolicyService(new FixedClock(
            new DateTimeOffset(2035, 2, day, hour, minute, 0, TimeSpan.Zero)));

    private sealed class FixedClock(DateTimeOffset nowUtc) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => nowUtc;
    }

    private sealed class CountingPolicy(SameNightBookingPolicyResult result) : IPropertySameNightBookingPolicyService
    {
        public int CallCount { get; private set; }
        public int PropertyId { get; private set; }
        public DateOnly CheckIn { get; private set; }

        public SameNightBookingPolicyResult Evaluate(Property property, DateOnly requestedCheckIn)
        {
            CallCount++;
            PropertyId = property.Id;
            CheckIn = requestedCheckIn;
            return result;
        }
    }

    private static async Task ConfigureChildRulesAsync(KoochDbContext db)
    {
        db.SiteSettings.AddRange(
            new SiteSetting { Key = ChildPricingRuleResolver.FreeChildMaxAgeKey, Value = "5", IsActive = true },
            new SiteSetting { Key = ChildPricingRuleResolver.HalfPriceChildMinAgeKey, Value = "6", IsActive = true },
            new SiteSetting { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
        await db.SaveChangesAsync();
    }

    private sealed class RecordingPricingService : IReservationPricingService
    {
        public List<ReservationPricePreviewRequest> Requests { get; } = [];
        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.FromResult(new ReservationPricePreviewResponse
            {
                PropertyId = request.PropertyId, RoomTypeId = request.RoomTypeId,
                CheckInDate = request.CheckInDate, CheckOutDate = request.CheckOutDate,
                NightsCount = 2, FinalAmount = 1234, Currency = "IRR"
            });
        }
    }

    private static async Task SeedAsync(KoochDbContext context)
    {
        context.Users.Add(new User
        {
            Id = 1,
            FirstName = "Client",
            LastName = "One",
            PasswordHash = "hash",
            Role = UserRole.Client,
            IsActive = true
        });
        context.Guests.Add(new Guest
        {
            Id = 1,
            UserId = 1,
            FirstName = "Guest",
            LastName = "One"
        });
        context.Properties.Add(new Property
        {
            Id = 1,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Public Property",
            Slug = "public-property",
            Description = "Description",
            Address = "Address",
            City = "City",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        context.RoomTypes.AddRange(
            RoomType(10, InventoryMode.NamedRooms),
            RoomType(20, InventoryMode.TypeBasedInventory));
        context.Rooms.AddRange(
            new Room { Id = 100, RoomTypeId = 10, Name = "Room 100", IsActive = true },
            new Room { Id = 101, RoomTypeId = 10, Name = "Room 101", IsActive = true });
        context.Availabilities.Add(new Availability
        {
            RoomTypeId = 20,
            Date = new DateOnly(2035, 2, 1),
            AvailableCount = 2,
            Status = AvailabilityStatus.OnRequest
        });
        context.Reservations.Add(new Reservation
        {
            ReservationNumber = "KCH-HOLD",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            RoomTypeId = 10,
            RoomId = 100,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            AdultCount = 1,
            Currency = "IRR",
            Status = ReservationStatus.ApprovedAwaitingPayment
        });
        await context.SaveChangesAsync();
    }

    private sealed class RecordingBookingOptionsService : IPublicBookingOptionsService
    {
        public Task<PublicBookingCandidatesResponse> GetCandidatesAsync(
            string slug, DateOnly checkInDate, DateOnly checkOutDate, int rooms,
            int adults, int children, IReadOnlyList<int> childAges,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new PublicBookingCandidatesResponse());

        public Task<PublicBookingQuoteResponse> QuoteAsync(
            string slug, PublicBookingQuoteRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PublicBookingQuoteResponse());

        public int Children { get; private set; }
        public IReadOnlyList<int> ChildAges { get; private set; } = [];

        public Task<PublicBookingOptionsResponse> GetAsync(
            string slug,
            DateOnly checkInDate,
            DateOnly checkOutDate,
            int adults,
            int children,
            IReadOnlyList<int> childAges,
            CancellationToken cancellationToken = default)
        {
            Children = children;
            ChildAges = childAges;
            return Task.FromResult(new PublicBookingOptionsResponse());
        }
    }

    private static async Task<KoochDbContext> CreatePricedContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"public-rate-plans-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);
        await SeedAsync(context);
        context.RoomDailyPrices.AddRange(
            new RoomDailyPrice { RoomTypeId = 10, Date = new DateOnly(2035, 2, 1), GuestType = PricingGuestType.Iranian, BasePrice = 120 },
            new RoomDailyPrice { RoomTypeId = 10, Date = new DateOnly(2035, 2, 2), GuestType = PricingGuestType.Iranian, BasePrice = 180 });
        await context.SaveChangesAsync();
        return context;
    }

    private static PublicBookingOptionsService AuthoritativeService(
        KoochDbContext context, IPropertySameNightBookingPolicyService? policy = null)
    {
        var childRules = new ChildPricingRuleResolver(context);
        return new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
            new ReservationPricingService(context, new PricingService(), childRules,
                new ReservationRulesResolver(context, childRules)), childRules, policy ?? DefaultPolicy());
    }

    private static IPropertySameNightBookingPolicyService DefaultPolicy() =>
        new PropertySameNightBookingPolicyService(TimeProvider.System);

    private static RatePlan Plan(int id, string name, decimal modifier, bool isActive = true,
        bool isDeleted = false, PriceModifierType type = PriceModifierType.FixedAmount,
        int? mealPlanId = null, int? minimumNights = null) => new()
    {
        Id = id, RoomTypeId = 10, Name = name, PriceModifierType = type,
        PriceModifierValue = modifier, IsActive = isActive, IsDeleted = isDeleted,
        MealPlanId = mealPlanId, MinimumNights = minimumNights
    };

    private static RoomType RoomType(
        int id,
        InventoryMode inventoryMode,
        int totalInventory = 2) =>
        new()
        {
            Id = id,
            PropertyId = 1,
            Name = "Room Type " + id,
            Slug = "room-type-" + id,
            Description = "Description",
            MaxAdults = 2,
            MaxChildren = 2,
            TotalInventory = totalInventory,
            InventoryMode = inventoryMode,
            BasePrice = 100,
            IsActive = true
        };

    private sealed class RangePricingService : IReservationPricingService
    {
        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            var nights = request.CheckOutDate.DayNumber - request.CheckInDate.DayNumber;
            return Task.FromResult(new ReservationPricePreviewResponse
            {
                PropertyId = request.PropertyId,
                RoomTypeId = request.RoomTypeId,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                Adults = request.Adults,
                Children = request.Children,
                NightsCount = nights,
                FinalAmount = nights * request.RoomTypeId,
                Currency = "IRR"
            });
        }
    }

    private sealed class IncompleteRangePricingService : IReservationPricingService
    {
        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<ReservationPricePreviewResponse> PreviewPublicBookingPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default) =>
            throw new IncompleteDailyPricingException(
                request.RoomTypeId,
                [request.CheckInDate]);
    }
}
