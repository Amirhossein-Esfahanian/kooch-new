using System.Reflection;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UndatedPropertySearchPricingTests
{
    [Theory]
    [InlineData(-1, false)]
    [InlineData(0, true)]
    [InlineData(89, true)]
    [InlineData(90, false)]
    [InlineData(365, false)]
    public async Task DailyPrice_UsesInclusiveTodayAndExclusiveDayNinety(int offset, bool qualifies)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.Add(fixture.Daily(10, offset, 1_000_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.Search.GetPublicPropertiesAsync());

        Assert.Equal(qualifies ? 1_000_000m : (decimal?)null, result.StartingPrice);
    }

    [Fact]
    public async Task FarFutureAndPastCheapPrices_DoNotDominateTheBoundedMinimum()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.AddRange(
            fixture.Daily(10, -1, 1), fixture.Daily(10, 1, 3_000_000),
            fixture.Daily(10, 89, 2_000_000), fixture.Daily(10, 90, 100_000),
            fixture.Daily(10, 365, 10_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(2_000_000m,
            Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Fact]
    public async Task BasePriceOnly_KeepsThePropertyVisibleWithoutAPrice()
    {
        await using var fixture = await Fixture.CreateAsync();

        var result = Assert.Single(await fixture.Search.GetPublicPropertiesAsync(rooms: 1, adults: 2));

        Assert.Equal(1, result.Id);
        Assert.Null(result.StartingPrice);
    }

    [Fact]
    public async Task ForeignDailyPrice_DoesNotSupplyAnIranianTeaser()
    {
        await using var fixture = await Fixture.CreateAsync();
        var price = fixture.Daily(10, 1, 1_000_000);
        price.GuestType = PricingGuestType.Foreign;
        fixture.Db.RoomDailyPrices.Add(price);
        await fixture.Db.SaveChangesAsync();

        Assert.Null(Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task NonPositiveDailyPrice_IsExcluded(int amount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.Add(fixture.Daily(10, 1, amount));
        await fixture.Db.SaveChangesAsync();

        Assert.Null(Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Theory]
    [InlineData("Inactive")]
    [InlineData("Deleted")]
    [InlineData("ZeroInventory")]
    [InlineData("NoBaseAdultCapacity")]
    public async Task StructurallyIneligibleRoomType_CannotSupplyTheCheapestPrice(string reason)
    {
        await using var fixture = await Fixture.CreateAsync();
        var room = await fixture.Db.RoomTypes.SingleAsync();
        switch (reason)
        {
            case "Inactive": room.IsActive = false; break;
            case "Deleted": room.IsDeleted = true; break;
            case "ZeroInventory": room.TotalInventory = 0; break;
            case "NoBaseAdultCapacity":
                room.MaxAdults = 0;
                room.AllowExtraGuest = true;
                room.MaxExtraGuests = 1;
                break;
        }
        fixture.Db.RoomTypes.Add(Fixture.Room(20));
        fixture.Db.RoomDailyPrices.AddRange(
            fixture.Daily(10, 1, 100_000), fixture.Daily(20, 1, 2_000_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(2_000_000m,
            Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Fact]
    public async Task DeletedDailyPrice_IsExcluded()
    {
        await using var fixture = await Fixture.CreateAsync();
        var price = fixture.Daily(10, 1, 100_000);
        price.IsDeleted = true;
        fixture.Db.RoomDailyPrices.Add(price);
        await fixture.Db.SaveChangesAsync();

        Assert.Null(Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Fact]
    public async Task CheaperRatePlanAndPromotion_DoNotChangeTheStandardTeaser()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.Add(fixture.Daily(10, 1, 1_000_000));
        fixture.Db.RatePlans.Add(new RatePlan
        {
            RoomTypeId = 10, Name = "Without breakfast", IsActive = true,
            PriceModifierType = PriceModifierType.FixedAmount, PriceModifierValue = -150_000,
            MinimumNights = 2
        });
        fixture.Db.Promotions.Add(new Promotion
        {
            PropertyId = 1, Title = "Half price", IsActive = true,
            Type = PromotionType.PercentageDiscount, Percentage = 50,
            StartDate = fixture.Today, EndDate = fixture.Today.AddDays(89),
            Weekdays = PromotionWeekday.All,
            PromotionRoomTypes = [new PromotionRoomType { RoomTypeId = 10 }]
        });
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(1_000_000m,
            Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Theory]
    [InlineData("SoldOut")]
    [InlineData("Closed")]
    [InlineData("Reserved")]
    public async Task UnobtainableCheapNight_StillSuppliesTheConfiguredTeaser(string reason)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomTypes.Add(Fixture.Room(20));
        fixture.Db.RoomDailyPrices.AddRange(
            fixture.Daily(10, 1, 1_000_000), fixture.Daily(20, 1, 1_500_000));
        if (reason == "Reserved")
        {
            for (var index = 0; index < 2; index++)
                fixture.Db.Reservations.Add(new Reservation
                {
                    ReservationNumber = $"R-{100000 + index}", PropertyId = 1,
                    RoomTypeId = 10, ClientId = 1, AdultCount = 1,
                    CheckInDate = fixture.Today.AddDays(1), CheckOutDate = fixture.Today.AddDays(2),
                    Status = ReservationStatus.Confirmed
                });
        }
        else
        {
            fixture.Db.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = fixture.Today.AddDays(1),
                AvailableCount = reason == "SoldOut" ? 0 : 2,
                Status = AvailabilityStatus.Available, IsClosed = reason == "Closed", Price = 1
            });
        }
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(1_000_000m,
            Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
    }

    [Fact]
    public async Task RequestedRooms_DoNotMultiplyTheTeaser()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.Add(fixture.Daily(10, 1, 1_000_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Equal(1_000_000m,
            Assert.Single(await fixture.Search.GetPublicPropertiesAsync(rooms: 2, adults: 2)).StartingPrice);
    }

    [Fact]
    public async Task RequestedParty_DoesNotRestrictThePricedRoomTypeOrAddGuestCharges()
    {
        await using var fixture = await Fixture.CreateAsync();
        var property = await fixture.Db.Properties.SingleAsync();
        property.ChildPrice = 350_000;
        property.ExtraGuestPrice = 200_000;
        var largerRoom = Fixture.Room(20);
        largerRoom.MaxAdults = 4;
        fixture.Db.RoomTypes.Add(largerRoom);
        fixture.Db.RoomDailyPrices.AddRange(
            fixture.Daily(10, 1, 1_000_000), fixture.Daily(20, 1, 5_000_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.Search.GetPublicPropertiesAsync(
            rooms: 2, adults: 5, children: 1, childAges: "7"));

        Assert.DoesNotContain(result.MatchingRoomTypes, room => room.Id == 10);
        Assert.Equal(1_000_000m, result.StartingPrice);
    }

    [Fact]
    public async Task PublicDetail_KeepsItsExistingUnboundedPriceProjection()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.Add(fixture.Daily(10, 365, 1_000_000));
        await fixture.Db.SaveChangesAsync();

        Assert.Null(Assert.Single(await fixture.Search.GetPublicPropertiesAsync()).StartingPrice);
        var detail = await fixture.Search.GetPublicPropertyBySlugAsync("priced-property");
        Assert.NotNull(detail);
        Assert.Equal(1_000_000m, detail.StartingPrice);
    }

    [Theory]
    [InlineData("StartOnly")]
    [InlineData("EndOnly")]
    [InlineData("Equal")]
    [InlineData("Reversed")]
    public async Task PartialOrInvalidRange_UsesTheUndatedContract(string range)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.RoomDailyPrices.AddRange(
            fixture.Daily(10, 1, 1_000_000), fixture.Daily(10, 365, 100_000));
        await fixture.Db.SaveChangesAsync();
        DateOnly? checkIn = range == "EndOnly" ? null : fixture.Today.AddDays(3);
        DateOnly? checkOut = range switch
        {
            "StartOnly" => null,
            "Equal" => checkIn,
            _ => fixture.Today.AddDays(2)
        };

        Assert.Equal(1_000_000m, Assert.Single(await fixture.Search.GetPublicPropertiesAsync(
            checkIn: checkIn, checkOut: checkOut)).StartingPrice);
    }

    [Fact]
    public void UndatedProjection_TranslatesToBoundedSqlServerMinWithoutConnecting()
    {
        using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=localhost;Database=QueryTranslationOnly;Integrated Security=true")
            .Options);
        var projection = typeof(PropertyService).GetMethod("ProjectPublic",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var query = (IQueryable<PublicPropertyResponse>)projection.Invoke(null,
            [db.Properties, 0, 0, false, null, null, 1, true])!;

        var sql = query.ToQueryString();

        Assert.Contains("MIN(", sql);
        Assert.Contains("[TotalInventory] > 0", sql);
        Assert.Contains("[MaxAdults] >= 1", sql);
        Assert.Contains("[Date] < @__undatedStartingPriceEndExclusive", sql);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public KoochDbContext Db { get; }
        public PropertyService Search { get; }
        public DateOnly Today { get; } = DateOnly.FromDateTime(DateTime.UtcNow);

        private Fixture(KoochDbContext db)
        {
            Db = db;
            Search = new PropertyService(db, null!, null!, null!, null!, new ChildPricingRuleResolver(db));
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
            db.RoomTypes.Add(Room(10));
            await db.SaveChangesAsync();
            return new Fixture(db);
        }

        public static RoomType Room(int id) => new()
        {
            Id = id, PropertyId = 1, Name = $"Room {id}", Slug = $"room-{id}",
            IsActive = true, MaxAdults = 2, MaxChildren = 1, TotalInventory = 2,
            InventoryMode = InventoryMode.TypeBasedInventory, BasePrice = 9_000_000
        };

        public RoomDailyPrice Daily(int roomTypeId, int offset, decimal price) => new()
        {
            RoomTypeId = roomTypeId, Date = Today.AddDays(offset),
            GuestType = PricingGuestType.Iranian, BasePrice = price
        };

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
