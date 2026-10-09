using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class DatedPropertySearchPricingTests
{
    private static readonly DateOnly CheckIn = new(2035, 2, 1);
    private static readonly DateOnly CheckOut = new(2035, 2, 3);

    [Fact]
    public async Task UndatedAndIncompleteRanges_KeepTheFutureCalendarMinimum()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.Equal(1_000_000m, Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
        Assert.Equal(1_000_000m, Assert.Single(await fixture.Search.GetPublicPropertiesAsync(
            checkIn: CheckIn)).StartingPrice);
        Assert.Equal(1_000_000m, Assert.Single(await fixture.Search.GetPublicPropertiesAsync(
            checkIn: CheckOut, checkOut: CheckIn)).StartingPrice);
    }

    [Fact]
    public async Task DatedSearch_UsesTheSelectedNightAndWholeStayAverage()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.Equal(2_400_000m, Assert.Single(await fixture.FindAsync(
            checkIn: CheckIn.AddDays(1), checkOut: CheckOut)).StartingPrice);
        Assert.Equal(2_200_000m, Assert.Single(await fixture.FindAsync()).StartingPrice);
    }

    [Fact]
    public async Task NegativeRatePlan_WinsUsingTheAuthoritativeCompleteStayQuote()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        await fixture.Db.SaveChangesAsync();

        var property = Assert.Single(await fixture.FindAsync());
        var options = await fixture.Options.GetAsync("priced-property", CheckIn, CheckOut, 2, 0, []);
        var room = Assert.Single(options.RoomTypes);
        Assert.Equal(4_400_000m, room.FinalAmount);
        Assert.Equal(4_000_000m, Assert.Single(room.RatePlans).FinalAmount);
        Assert.Equal(2_000_000m, property.StartingPrice);
        Assert.Equal(1_000_000m, Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Fact]
    public async Task PositiveRatePlan_DoesNotReplaceTheCheaperStandardOffer()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RatePlans.Add(Plan(51, 200_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(2_200_000m, Assert.Single(await fixture.FindAsync()).StartingPrice);
    }

    [Theory]
    [InlineData("MinimumNights")]
    [InlineData("InvalidMinimumNights")]
    [InlineData("Inactive")]
    [InlineData("Deleted")]
    [InlineData("Percentage")]
    [InlineData("NonPositiveNight")]
    [InlineData("DeletedMealPlan")]
    public async Task IneligibleRatePlans_DoNotSetStartingPrice(string reason)
    {
        await using var fixture = await Fixture.CreateAsync();
        var plan = Plan(51, reason == "NonPositiveNight" ? -2_000_000 : -200_000);
        switch (reason)
        {
            case "MinimumNights": plan.MinimumNights = 3; break;
            case "InvalidMinimumNights": plan.MinimumNights = 0; break;
            case "Inactive": plan.IsActive = false; break;
            case "Deleted": plan.IsDeleted = true; break;
            case "Percentage": plan.PriceModifierType = PriceModifierType.Percentage; break;
            case "DeletedMealPlan":
                fixture.Db.MealPlans.Add(new MealPlan
                {
                    Id = 70, Name = "Deleted meal", Slug = "deleted-meal", IsDeleted = true
                });
                plan.MealPlanId = 70;
                break;
        }
        fixture.Db.RatePlans.Add(plan);
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(2_200_000m, Assert.Single(await fixture.FindAsync()).StartingPrice);
    }

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 0)]
    [InlineData(2, 1)]
    public async Task IncompleteOrInsufficientAvailability_DoesNotReturnAFalsePrice(
        int requestedRooms, int remainingFirstNight)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = CheckIn, AvailableCount = remainingFirstNight,
            Status = remainingFirstNight == 0 ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available
        });
        await fixture.Db.SaveChangesAsync();

        Assert.Empty(await fixture.FindAsync(rooms: requestedRooms));
    }

    [Fact]
    public async Task AClosedSecondNightOrMissingCalendarPrice_ExcludesTheRoomType()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = CheckIn.AddDays(1), AvailableCount = 0,
            Status = AvailabilityStatus.Unavailable
        });
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.FindAsync());

        fixture.Db.Availabilities.RemoveRange(fixture.Db.Availabilities);
        fixture.Db.RoomDailyPrices.Remove(await fixture.Db.RoomDailyPrices.SingleAsync(price =>
            price.RoomTypeId == 10 && price.Date == CheckIn.AddDays(1)));
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.FindAsync());
    }

    [Fact]
    public async Task RequestedRoomCount_UsesSufficientSameTypeInventoryAndPricesAllUnits()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.Equal(4_400_000m, Assert.Single(await fixture.FindAsync(
            rooms: 2, adults: 4)).StartingPrice);
        Assert.Empty(await fixture.FindAsync(rooms: 3, adults: 4));
    }

    [Fact]
    public async Task RoomCount_DoesNotCombineInventoryAcrossDifferentRoomTypes()
    {
        await using var fixture = await Fixture.CreateAsync();
        (await fixture.Db.RoomTypes.SingleAsync(roomType => roomType.Id == 10)).TotalInventory = 1;
        var second = Room(20, 1_500_000);
        second.TotalInventory = 1;
        fixture.Db.RoomTypes.Add(second);
        fixture.Db.RoomDailyPrices.AddRange(
            Daily(20, CheckIn, 1_500_000), Daily(20, CheckIn.AddDays(1), 1_500_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Empty(await fixture.FindAsync(rooms: 2, adults: 4));
    }

    [Fact]
    public async Task InactiveOrGuestIneligibleRoomTypes_DoNotSetDatedPrice()
    {
        await using var fixture = await Fixture.CreateAsync();
        Assert.Empty(await fixture.FindAsync(adults: 3));
        Assert.Empty(await fixture.FindAsync(children: 2, childAges: "7,8"));

        (await fixture.Db.RoomTypes.SingleAsync(roomType => roomType.Id == 10)).IsActive = false;
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.FindAsync());
    }

    [Fact]
    public async Task OnRequestAvailability_RemainsAValidBookableOffer()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = CheckIn, AvailableCount = 2,
            Status = AvailabilityStatus.OnRequest
        });
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(2_200_000m, Assert.Single(await fixture.FindAsync()).StartingPrice);
    }

    [Fact]
    public async Task GuestChargesAndPromotions_MatchTheAuthoritativeReservationPreview()
    {
        await using var fixture = await Fixture.CreateAsync();
        var room = await fixture.Db.RoomTypes.SingleAsync(item => item.Id == 10);
        room.AllowExtraGuest = true;
        room.MaxExtraGuests = 1;
        var property = await fixture.Db.Properties.SingleAsync(item => item.Id == 1);
        property.ExtraGuestPrice = 100_000;
        fixture.Db.Promotions.Add(new Promotion
        {
            Id = 71, PropertyId = 1, Title = "Ten percent", Type = PromotionType.PercentageDiscount,
            Percentage = 10, StartDate = CheckIn, EndDate = CheckOut,
            Weekdays = PromotionWeekday.All, IsActive = true,
            PromotionRoomTypes = [new PromotionRoomType { RoomTypeId = 10 }]
        });
        await fixture.Db.SaveChangesAsync();

        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(new ReservationPricePreviewRequest
        {
            PropertyId = 1, RoomTypeId = 10, CheckInDate = CheckIn, CheckOutDate = CheckOut,
            Adults = 3, Children = 0, ChildAges = [], RoomCount = 1,
            GuestType = PricingGuestType.Iranian
        });
        Assert.Equal(quote.FinalAmount / 2, Assert.Single(await fixture.FindAsync(adults: 3)).StartingPrice);
        Assert.True(quote.ExtraGuestAmount > 0);
        Assert.True(quote.DiscountAmount > 0);

        var childQuote = await fixture.Pricing.PreviewPublicBookingPriceAsync(new ReservationPricePreviewRequest
        {
            PropertyId = 1, RoomTypeId = 10, CheckInDate = CheckIn, CheckOutDate = CheckOut,
            Adults = 2, Children = 1, ChildAges = [7], RoomCount = 1,
            GuestType = PricingGuestType.Iranian
        });
        Assert.Equal(childQuote.FinalAmount / 2, Assert.Single(await fixture.FindAsync(
            adults: 2, children: 1, childAges: "7")).StartingPrice);
        Assert.True(childQuote.ChildAmount > 0);
    }

    [Fact]
    public async Task CheapestOfferAcrossRoomTypesWins_WithoutMixingRoomTypes()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomTypes.Add(Room(20, 1_500_000));
        fixture.Db.RoomDailyPrices.AddRange(
            Daily(20, CheckIn, 1_500_000), Daily(20, CheckIn.AddDays(1), 1_500_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.FindAsync());
        Assert.Equal(1_500_000m, result.StartingPrice);
        Assert.Equal(2, result.MatchingRoomTypesCount);
    }

    private static RatePlan Plan(int id, decimal modifier) => new()
    {
        Id = id, RoomTypeId = 10, Name = "Alternative", IsActive = true,
        PriceModifierType = PriceModifierType.FixedAmount,
        PriceModifierValue = modifier
    };

    private static RoomType Room(int id, decimal basePrice) => new()
    {
        Id = id, PropertyId = 1, Name = $"Room {id}", Slug = $"room-{id}",
        Description = "Room", IsActive = true, MaxAdults = 2, MaxChildren = 1,
        TotalInventory = 2, InventoryMode = InventoryMode.TypeBasedInventory,
        BasePrice = basePrice
    };

    private static RoomDailyPrice Daily(int roomTypeId, DateOnly date, decimal price) => new()
    {
        RoomTypeId = roomTypeId, Date = date,
        GuestType = PricingGuestType.Iranian, BasePrice = price
    };

    private sealed class Fixture : IAsyncDisposable
    {
        public KoochDbContext Db { get; }
        public PropertyService Search { get; }
        public ReservationPricingService Pricing { get; }
        public PublicBookingOptionsService Options { get; }

        private Fixture(KoochDbContext db)
        {
            Db = db;
            var childRules = new ChildPricingRuleResolver(db);
            Pricing = new ReservationPricingService(db, new PricingService(), childRules,
                new ReservationRulesResolver(db, childRules));
            var availability = new EffectiveAvailabilityService(db);
            Options = new PublicBookingOptionsService(db, availability, Pricing);
            Search = new PropertyService(db, null!, null!, null!, null!, childRules,
                new DatedPropertyStartingPriceService(db, availability, childRules, Pricing));
        }

        public static async Task<Fixture> CreateAsync()
        {
            var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
            db.Properties.Add(new Property
            {
                Id = 1, OwnerId = 1, DestinationId = 1, Name = "Priced property",
                Slug = "priced-property", Description = "Description", Address = "Address",
                City = "City", Country = "IR", Status = PropertyStatus.Approved
            });
            db.RoomTypes.Add(Room(10, 9_000_000));
            db.RoomDailyPrices.AddRange(
                Daily(10, CheckIn, 2_000_000),
                Daily(10, CheckIn.AddDays(1), 2_400_000),
                Daily(10, CheckOut.AddDays(10), 1_000_000));
            await db.SaveChangesAsync();
            return new Fixture(db);
        }

        public Task<IReadOnlyList<PublicPropertyResponse>> FindAsync(
            DateOnly? checkIn = null, DateOnly? checkOut = null,
            int rooms = 1, int adults = 2, int children = 0, string? childAges = null) =>
            Search.GetPublicPropertiesAsync(checkIn: checkIn ?? CheckIn,
                checkOut: checkOut ?? CheckOut, rooms: rooms, adults: adults,
                children: children, childAges: childAges);

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
