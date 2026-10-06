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

public sealed class PublicBookingOptionsTests
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
            new RangePricingService());

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
            new RangePricingService());

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
            new RangePricingService());

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
            new RangePricingService());

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
            new IncompleteRangePricingService());

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

    private static PublicBookingOptionsService AuthoritativeService(KoochDbContext context)
    {
        var childRules = new ChildPricingRuleResolver(context);
        return new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
            new ReservationPricingService(context, new PricingService(), childRules,
                new ReservationRulesResolver(context, childRules)));
    }

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
