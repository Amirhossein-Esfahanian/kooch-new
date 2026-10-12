using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UndatedPropertySearchEligibilityTests
{
    [Theory]
    [InlineData(1, 1, true)]
    [InlineData(2, 1, false)]
    [InlineData(2, 2, true)]
    [InlineData(0, 1, true)]
    public async Task RequestedRooms_RequireInventoryOnOneRoomType(int rooms, int inventory, bool included)
    {
        await using var fixture = await Fixture.CreateAsync(inventory: inventory);
        var results = await fixture.Service.GetPublicPropertiesAsync(rooms: rooms, adults: 2);
        Assert.Equal(included ? 1 : 0, results.Count);
    }

    [Fact]
    public async Task InventoryFromDifferentRoomTypes_IsNotCombined()
    {
        await using var fixture = await Fixture.CreateAsync(inventory: 1);
        fixture.Db.RoomTypes.Add(Fixture.Room(20, 1));
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.Service.GetPublicPropertiesAsync(rooms: 2, adults: 2));
    }

    [Theory]
    [InlineData(2, false, 1, 1, true)]
    [InlineData(3, true, 1, 1, true)]
    [InlineData(3, false, 1, 1, false)]
    [InlineData(4, true, 1, 1, false)]
    [InlineData(6, true, 1, 2, true)]
    public async Task Adults_UseBaseAndOnlyEnabledExtraCapacityAcrossRooms(
        int adults, bool allowExtra, int extra, int rooms, bool included)
    {
        await using var fixture = await Fixture.CreateAsync();
        var room = await fixture.Db.RoomTypes.SingleAsync();
        room.AllowExtraGuest = allowExtra;
        room.MaxExtraGuests = extra;
        await fixture.Db.SaveChangesAsync();
        Assert.Equal(included ? 1 : 0,
            (await fixture.Service.GetPublicPropertiesAsync(rooms: rooms, adults: adults)).Count);
    }

    [Theory]
    [InlineData(2, "8,8", 2, true)]
    [InlineData(3, "8,8,8", 2, false)]
    [InlineData(1, "15", 1, false)]
    [InlineData(1, "15", 2, true)]
    [InlineData(3, "3,3,3", 1, false)]
    public async Task Children_ReuseAgeClassificationAndScaleCapacity(
        int children, string ages, int rooms, bool included)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "5"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "6"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12"));
        var property = await fixture.Db.Properties.SingleAsync();
        property.MaxFreeChildren = 1;
        await fixture.Db.SaveChangesAsync();
        Assert.Equal(included ? 1 : 0, (await fixture.Service.GetPublicPropertiesAsync(
            rooms: rooms, adults: 2, children: children, childAges: ages)).Count);
    }

    [Fact]
    public async Task PropertyChildOverride_RemainsAuthoritativeOverGlobalDefaults()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Db.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "5"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "6"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12"));
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.Service.GetPublicPropertiesAsync(
            rooms: 1, adults: 2, children: 1, childAges: "15"));
        (await fixture.Db.Properties.SingleAsync()).FreeChildAgeLimit = 16;
        await fixture.Db.SaveChangesAsync();
        Assert.Single(await fixture.Service.GetPublicPropertiesAsync(
            rooms: 1, adults: 2, children: 1, childAges: "15"));
    }

    [Theory]
    [InlineData("0", 0, false)]
    [InlineData("4", 0, false)]
    [InlineData("4", 1, true)]
    [InlineData("8", 0, false)]
    [InlineData("8", 1, true)]
    [InlineData("4,5", 1, false)]
    [InlineData("4,8", 1, false)]
    [InlineData("4,8", 2, true)]
    public async Task AllNonAdultEquivalentChildren_ConsumeMaxChildren(
        string ages, int childCapacity, bool included)
    {
        await using var fixture = await Fixture.CreateAsync();
        await ConfigureChildRulesAsync(fixture);
        (await fixture.Db.RoomTypes.SingleAsync()).MaxChildren = childCapacity;
        await fixture.Db.SaveChangesAsync();
        Assert.Equal(included ? 1 : 0, (await fixture.Service.GetPublicPropertiesAsync(
            adults: 2, children: ages.Split(',').Length, childAges: ages)).Count);
    }

    [Theory]
    [InlineData(1, false, 1, true)]
    [InlineData(2, false, 1, false)]
    [InlineData(2, true, 1, true)]
    [InlineData(2, true, 0, false)]
    public async Task AdultEquivalentChildren_UseAdultCapacityInsteadOfChildCapacity(
        int adults, bool allowExtra, int extra, bool included)
    {
        await using var fixture = await Fixture.CreateAsync();
        await ConfigureChildRulesAsync(fixture);
        var room = await fixture.Db.RoomTypes.SingleAsync();
        room.MaxChildren = 0;
        room.AllowExtraGuest = allowExtra;
        room.MaxExtraGuests = extra;
        await fixture.Db.SaveChangesAsync();
        Assert.Equal(included ? 1 : 0, (await fixture.Service.GetPublicPropertiesAsync(
            adults: adults, children: 1, childAges: "15")).Count);
    }

    [Theory]
    [InlineData(null, 1, "4", true)]
    [InlineData(0, 1, "4", true)]
    [InlineData(1, 1, "4", true)]
    [InlineData(null, 1, "4,5", false)]
    [InlineData(0, 1, "4,5", false)]
    [InlineData(1, 1, "4,5", false)]
    [InlineData(1, 2, "4,5", true)]
    [InlineData(1, 2, "4,5,6", false)]
    public async Task FreeQuota_DoesNotChangeStructuralChildCapacity(
        int? quota, int rooms, string ages, bool included)
    {
        await using var fixture = await Fixture.CreateAsync();
        await ConfigureChildRulesAsync(fixture);
        (await fixture.Db.Properties.SingleAsync()).MaxFreeChildren = quota;
        await fixture.Db.SaveChangesAsync();
        Assert.Equal(included ? 1 : 0, (await fixture.Service.GetPublicPropertiesAsync(
            rooms: rooms, adults: 2, children: ages.Split(',').Length, childAges: ages)).Count);
    }

    [Fact]
    public async Task CoarsePrefilter_DoesNotRejectEnabledExtraCapacityWithZeroBaseCapacity()
    {
        await using var fixture = await Fixture.CreateAsync();
        var room = await fixture.Db.RoomTypes.SingleAsync();
        room.MaxAdults = 0;
        room.AllowExtraGuest = true;
        room.MaxExtraGuests = 2;
        await fixture.Db.SaveChangesAsync();
        Assert.Single(await fixture.Service.GetPublicPropertiesAsync(adults: 1));
        var broad = Assert.Single(await fixture.Service.GetPublicPropertiesAsync());
        Assert.Empty(broad.MatchingRoomTypes);
    }

    [Fact]
    public async Task RoomsOnlyFilter_DoesNotIntroduceAdultSupervisionRequirement()
    {
        await using var fixture = await Fixture.CreateAsync();
        (await fixture.Db.RoomTypes.SingleAsync()).MaxAdults = 0;
        await fixture.Db.SaveChangesAsync();
        Assert.Single(await fixture.Service.GetPublicPropertiesAsync(rooms: 1));
    }

    [Fact]
    public async Task MissingAges_AreRejectedInsteadOfUsingTheSearchFallback()
    {
        await using var fixture = await Fixture.CreateAsync();
        await ConfigureChildRulesAsync(fixture);
        var room = await fixture.Db.RoomTypes.SingleAsync();
        room.MaxChildren = 0;
        room.AllowExtraGuest = true;
        room.MaxExtraGuests = 1;
        await fixture.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.GetPublicPropertiesAsync(adults: 2, children: 1));
        var explicitFallback = await fixture.Service.GetPublicPropertiesAsync(
            adults: 2, children: 1, childAges: "17");
        Assert.Single(explicitFallback);
    }

    private static async Task ConfigureChildRulesAsync(Fixture fixture)
    {
        fixture.Db.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "5"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "6"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12"));
        await fixture.Db.SaveChangesAsync();
    }

    [Theory]
    [InlineData("Inactive")]
    [InlineData("Deleted")]
    [InlineData("NoAdultCapacity")]
    [InlineData("NoInventory")]
    public async Task NoStructuralMatch_IsExcludedOnlyWithGuestFilter(string reason)
    {
        await using var fixture = await Fixture.CreateAsync();
        var room = await fixture.Db.RoomTypes.SingleAsync();
        switch (reason)
        {
            case "Inactive": room.IsActive = false; break;
            case "Deleted": room.IsDeleted = true; break;
            case "NoAdultCapacity": room.MaxAdults = 0; room.AllowExtraGuest = false; room.MaxExtraGuests = 0; break;
            case "NoInventory": room.TotalInventory = 0; break;
        }
        await fixture.Db.SaveChangesAsync();
        Assert.Empty(await fixture.Service.GetPublicPropertiesAsync(rooms: 1, adults: 1));
        var broadResult = Assert.Single(await fixture.Service.GetPublicPropertiesAsync());
        Assert.Equal("Unknown", broadResult.AvailabilityStatusSummary);
        Assert.Equal("برای بررسی موجودی، تاریخ را انتخاب کنید", broadResult.AvailabilitySummary);
        Assert.Equal("ظرفیت نامشخص", broadResult.GuestFitStatus);
        Assert.False(broadResult.IsInstantBooking);
    }

    [Fact]
    public async Task MatchingRoomTypes_MustSatisfyAllRequirementsOnTheSameType()
    {
        await using var fixture = await Fixture.CreateAsync(inventory: 1);
        var adultRoom = Fixture.Room(20, 2);
        adultRoom.MaxChildren = 0;
        var fittingRoom = Fixture.Room(30, 2);
        fixture.Db.RoomTypes.AddRange(adultRoom, fittingRoom);
        await fixture.Db.SaveChangesAsync();
        var result = Assert.Single(await fixture.Service.GetPublicPropertiesAsync(
            rooms: 2, adults: 4, children: 2, childAges: "17,17"));
        Assert.Equal(1, result.MatchingRoomTypesCount);
        Assert.Equal(30, Assert.Single(result.MatchingRoomTypes).Id);
        Assert.Equal("متناسب با تعداد مهمانان", result.GuestFitStatus);
    }

    [Theory]
    [InlineData("None")]
    [InlineData("Available")]
    [InlineData("OnRequest")]
    [InlineData("Unavailable")]
    [InlineData("Closed")]
    [InlineData("Consumed")]
    public async Task FutureAvailability_DoesNotChangeStructuralEligibilityOrNeutralStatus(string mode)
    {
        await using var fixture = await Fixture.CreateAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (mode != "None")
            fixture.Db.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = today, AvailableCount = mode == "Unavailable" ? 0 : 2,
                Status = mode == "OnRequest" ? AvailabilityStatus.OnRequest :
                    mode == "Unavailable" ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available,
                IsClosed = mode == "Closed"
            });
        if (mode == "Consumed")
            for (var i = 0; i < 2; i++)
                fixture.Db.Reservations.Add(new Reservation
                {
                    ReservationNumber = $"R-{100000 + i}", PropertyId = 1, RoomTypeId = 10,
                    ClientId = 1, AdultCount = 1, CheckInDate = today,
                    CheckOutDate = today.AddDays(90), Status = ReservationStatus.Confirmed
                });
        await fixture.Db.SaveChangesAsync();
        var result = Assert.Single(await fixture.Service.GetPublicPropertiesAsync(rooms: 2, adults: 4));
        Assert.Equal("Unknown", result.AvailabilityStatusSummary);
        Assert.Equal("برای بررسی موجودی، تاریخ را انتخاب کنید", result.AvailabilitySummary);
        Assert.False(result.IsInstantBooking);
        Assert.Equal(1, result.MatchingRoomTypesCount);
    }

    [Theory]
    [InlineData("StartOnly")]
    [InlineData("Equal")]
    [InlineData("Reversed")]
    public async Task InvalidOrPartialRange_IsRejected(string mode)
    {
        await using var fixture = await Fixture.CreateAsync(inventory: 1);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        DateOnly? end = mode == "StartOnly" ? null : mode == "Equal" ? today : today.AddDays(-1);
        await Assert.ThrowsAsync<ArgumentException>(() => fixture.Service.GetPublicPropertiesAsync(
            checkIn: today, checkOut: end, rooms: 2, adults: 2));
    }

    private static SiteSetting Setting(string key, string value) => new()
    {
        Key = key, Value = value, IsActive = true
    };

    private sealed class Fixture : IAsyncDisposable
    {
        public KoochDbContext Db { get; }
        public PropertyService Service { get; }
        private Fixture(KoochDbContext db)
        {
            Db = db;
            Service = new PropertyService(db, null!, null!, null!, null!, new ChildPricingRuleResolver(db));
        }
        public static async Task<Fixture> CreateAsync(int inventory = 2)
        {
            var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
            db.Properties.Add(new Property
            {
                Id = 1, OwnerId = 1, DestinationId = 1, Name = "Property", Slug = "property",
                Description = "Description", Address = "Address", City = "City", Country = "IR",
                Status = PropertyStatus.Approved
            });
            db.RoomTypes.Add(Room(10, inventory));
            await db.SaveChangesAsync();
            return new Fixture(db);
        }
        public static RoomType Room(int id, int inventory) => new()
        {
            Id = id, PropertyId = 1, Name = $"Room {id}", Slug = $"room-{id}",
            IsActive = true, MaxAdults = 2, MaxChildren = 1, TotalInventory = inventory,
            InventoryMode = InventoryMode.TypeBasedInventory
        };
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
