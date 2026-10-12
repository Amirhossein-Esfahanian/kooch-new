using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationPricingOccupancyV2Tests
{
    [Theory]
    [InlineData(0)]
    [InlineData(17)]
    public async Task InclusiveAgeBoundaries_AreAccepted(int age)
    {
        await using var fixture = await Fixture.CreateAsync();
        var request = fixture.Request(1, [age]);
        Assert.Equal(200m, (await fixture.Pricing.PreviewPublicBookingPriceAsync(request)).FinalAmount);
        Assert.Equal(200m, (await fixture.Pricing.PreviewReservationPriceAsync(request)).FinalAmount);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(18)]
    [InlineData(120)]
    public async Task InvalidAges_AreRejectedWithoutClamping(int age)
    {
        await using var fixture = await Fixture.CreateAsync();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(1, [age])));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public async Task AgeCountMustMatchDeclaredChildren(int ageCount)
    {
        await using var fixture = await Fixture.CreateAsync();
        var request = fixture.Request(2, Enumerable.Repeat(4, ageCount).ToArray());
        request.Children = 1;
        await Assert.ThrowsAsync<ArgumentException>(() => fixture.Pricing.PreviewPublicBookingPriceAsync(request));
    }

    [Theory]
    [InlineData(4, 0, false)]
    [InlineData(4, 1, true)]
    [InlineData(8, 0, false)]
    [InlineData(8, 1, true)]
    public async Task FreeAndChildRateChildren_ConsumeMaxChildren(int age, int capacity, bool accepted)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.MaxChildren = capacity;
        await fixture.Db.SaveChangesAsync();
        await AssertEligibilityAsync(fixture, fixture.Request(2, [age]), accepted);
    }

    [Theory]
    [InlineData(1, false, 1, true)]
    [InlineData(2, false, 1, false)]
    [InlineData(2, true, 1, true)]
    [InlineData(2, true, 0, false)]
    public async Task AdultEquivalentChildren_ConsumeOnlyAdultAndEnabledExtraCapacity(
        int adults, bool allowExtra, int extra, bool accepted)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.MaxChildren = 0;
        fixture.Room.AllowExtraGuest = allowExtra;
        fixture.Room.MaxExtraGuests = extra;
        await fixture.Db.SaveChangesAsync();
        await AssertEligibilityAsync(fixture, fixture.Request(adults, [15]), accepted);
    }

    [Theory]
    [InlineData(2, 2, 2, true)]
    [InlineData(2, 1, 2, false)]
    [InlineData(4, 1, 2, false)]
    [InlineData(2, 3, 3, true)]
    public async Task MaxChildren_ReplacesDerivedMaxAdultsMinusOne(
        int maxAdults, int maxChildren, int children, bool accepted)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.MaxAdults = maxAdults;
        fixture.Room.MaxChildren = maxChildren;
        await fixture.Db.SaveChangesAsync();
        await AssertEligibilityAsync(fixture, fixture.Request(2, Enumerable.Repeat(4, children).ToArray()), accepted);
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData(0, 200)]
    [InlineData(1, 100)]
    public async Task FreeQuota_ChangesChildChargeWithoutChangingOccupancy(int? quota, int childAmount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Property.MaxFreeChildren = quota;
        await fixture.Db.SaveChangesAsync();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(2, [4, 5]));
        Assert.Equal(200m + childAmount, quote.FinalAmount);
        Assert.Equal(childAmount, quote.ChildAmount);
        Assert.Equal(2, quote.Children);
        fixture.Room.MaxChildren = 1;
        await fixture.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(2, [4, 5])));
    }

    [Fact]
    public async Task MultiRoomCapacity_ScalesChildrenAndAdultEquivalents()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.MaxChildren = 1;
        fixture.Room.AllowExtraGuest = true;
        fixture.Room.MaxExtraGuests = 1;
        await fixture.Db.SaveChangesAsync();
        var request = fixture.Request(4, [4, 8, 15, 17]);
        request.RoomCount = 2;
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(request);
        Assert.Equal(6, quote.Adults);
        Assert.Equal(2, quote.Children);
        request.RoomCount = 1;
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Pricing.PreviewPublicBookingPriceAsync(request));
    }

    [Fact]
    public async Task ZeroAdults_DoesNotAddSupervisionValidation()
    {
        await using var fixture = await Fixture.CreateAsync();
        Assert.Equal(200m, (await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(0, [4]))).FinalAmount);
    }

    [Theory]
    [InlineData(1, 0, 300, 100, 0)]
    [InlineData(2, 0, 300, 100, 0)]
    [InlineData(3, 0, 360, 100, 60)]
    [InlineData(2, -10, 280, 100, 0)]
    public async Task ChildCharge_IsIndependentOfSpareAdultCapacityWithExistingExtraAndRatePlanRates(
        int adults, int modifier, int total, int childAmount, int extraAmount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.AllowExtraGuest = true;
        fixture.Room.MaxExtraGuests = 1;
        var request = fixture.Request(adults, [8]);
        if (modifier != 0)
        {
            fixture.Db.RatePlans.Add(new RatePlan
            {
                Id = 50, RoomTypeId = 10, Name = "Alternative", IsActive = true,
                PriceModifierType = PriceModifierType.FixedAmount, PriceModifierValue = modifier
            });
            request.RatePlanId = 50;
        }
        await fixture.Db.SaveChangesAsync();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(request);
        Assert.Equal(total, quote.FinalAmount);
        Assert.Equal(childAmount, quote.ChildAmount);
        Assert.Equal(extraAmount, quote.ExtraGuestAmount);
    }

    [Fact]
    public async Task Promotions_StillApplyAfterExistingGuestCharges()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.AllowExtraGuest = true;
        fixture.Room.MaxExtraGuests = 1;
        fixture.Db.Promotions.Add(new Promotion
        {
            Id = 70, PropertyId = 1, Title = "Ten percent", Type = PromotionType.PercentageDiscount,
            Percentage = 10, StartDate = Fixture.CheckIn, EndDate = Fixture.CheckIn.AddDays(2),
            Weekdays = PromotionWeekday.All, IsActive = true,
            PromotionRoomTypes = [new PromotionRoomType { RoomTypeId = 10 }]
        });
        await fixture.Db.SaveChangesAsync();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(3, [8]));
        Assert.Equal(324m, quote.FinalAmount);
        Assert.Equal(36m, quote.DiscountAmount);
        Assert.Equal(100m, quote.ChildAmount);
        Assert.Equal(60m, quote.ExtraGuestAmount);
    }

    [Theory]
    [InlineData(2, "", 0, 0, 2, 0)]
    [InlineData(2, "4", 0, 0, 2, 1)]
    [InlineData(1, "8", 100, 0, 1, 1)]
    [InlineData(2, "8", 100, 0, 2, 1)]
    [InlineData(2, "8,9", 200, 0, 2, 2)]
    [InlineData(1, "15", 0, 0, 2, 0)]
    [InlineData(2, "15", 0, 60, 3, 0)]
    [InlineData(2, "4,8,15", 100, 60, 3, 2)]
    public async Task ClassifiedChildren_ReceiveOnlyTheirApplicableChargeAndPreserveGuestCounts(
        int adults, string agesCsv, int childAmount, int extraAmount, int persistedAdults, int persistedChildren)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Room.AllowExtraGuest = true;
        fixture.Room.MaxExtraGuests = 1;
        await fixture.Db.SaveChangesAsync();
        int[] ages = agesCsv.Length == 0 ? [] : agesCsv.Split(',').Select(int.Parse).ToArray();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(adults, ages));
        Assert.Equal(childAmount, quote.ChildAmount);
        Assert.Equal(extraAmount, quote.ExtraGuestAmount);
        Assert.Equal(200m + childAmount + extraAmount, quote.FinalAmount);
        Assert.Equal(persistedAdults, quote.Adults);
        Assert.Equal(persistedChildren, quote.Children);
    }

    [Theory]
    [InlineData(null, 75)]
    [InlineData(0, 0)]
    [InlineData(37, 74)]
    public async Task ChildRateResolution_RetainsExplicitOverrideAndDailyGlobalFallback(int? overridePrice, int childAmount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Property.ChildPrice = overridePrice;
        fixture.Db.SiteSettings.Add(new SiteSetting
        {
            Key = ChildPricingRuleResolver.HalfPriceChildRateKey, Value = "25", IsActive = true
        });
        (await fixture.Db.RoomDailyPrices.SingleAsync(item => item.Date == Fixture.CheckIn.AddDays(1))).BasePrice = 200;
        fixture.Db.RatePlans.Add(new RatePlan
        {
            Id = 50, RoomTypeId = 10, Name = "Alternative", IsActive = true,
            PriceModifierType = PriceModifierType.FixedAmount, PriceModifierValue = -10
        });
        await fixture.Db.SaveChangesAsync();
        var request = fixture.Request(1, [8]);
        request.RatePlanId = 50;
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(request);
        Assert.Equal(childAmount, quote.ChildAmount);
        Assert.Equal(280m, quote.BaseAmount);
        Assert.Equal(280m + childAmount, quote.FinalAmount);
    }

    [Theory]
    [InlineData(1, 2, "4,5", 2, 0)]
    [InlineData(1, 2, "4,5,4", 3, 150)]
    [InlineData(null, 2, "8,9", 3, 300)]
    [InlineData(0, 2, "4,5", 3, 300)]
    [InlineData(1, 1, "4,5", 3, 150)]
    public async Task ChildCharges_ScaleByNightsAndActualPartyWhileFreeQuotaScalesByRooms(
        int? quota, int rooms, string agesCsv, int nights, int childAmount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Property.MaxFreeChildren = quota;
        fixture.Db.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = 10, Date = Fixture.CheckIn.AddDays(2), GuestType = PricingGuestType.Iranian, BasePrice = 100
        });
        await fixture.Db.SaveChangesAsync();
        var request = fixture.Request(2, agesCsv.Split(',').Select(int.Parse).ToArray());
        request.RoomCount = rooms;
        request.CheckOutDate = Fixture.CheckIn.AddDays(nights);
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(request);
        Assert.Equal(childAmount, quote.ChildAmount);
        Assert.Equal(100m * nights * rooms, quote.BaseAmount);
        Assert.Equal(quote.BaseAmount + childAmount, quote.FinalAmount);
        Assert.Equal(request.Children, quote.Children);
        Assert.All(quote.Nights, night => Assert.Equal((decimal)childAmount / nights, night.ChildAmount));
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData(0, 0)]
    [InlineData(30, 60)]
    public async Task AdultEquivalentExtraGuest_RetainsNullZeroAndPositiveRatePolicy(int? price, int extraAmount)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Property.ExtraGuestPrice = price;
        fixture.Room.AllowExtraGuest = true;
        fixture.Room.MaxExtraGuests = 1;
        await fixture.Db.SaveChangesAsync();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(2, [15]));
        Assert.Equal(0m, quote.ChildAmount);
        Assert.Equal(extraAmount, quote.ExtraGuestAmount);
        Assert.Equal(200m + extraAmount, quote.FinalAmount);
    }

    [Fact]
    public void GenericCalculator_RetainsItsExistingCapacityBasedContract()
    {
        var calculator = new PricingService();
        var legacy = calculator.CalculateNightPrice(2, 0, 100, 50, 30, 1, 1);
        var classified = calculator.CalculateClassifiedNightPrice(2, 100, 50, 30, 1, 1);
        Assert.Equal(0m, legacy.ChildCharge);
        Assert.Equal(100m, legacy.TotalPrice);
        Assert.Equal(50m, classified.ChildCharge);
        Assert.Equal(150m, classified.TotalPrice);
    }

    private static async Task AssertEligibilityAsync(Fixture fixture, ReservationPricePreviewRequest request, bool accepted)
    {
        if (accepted) await fixture.Pricing.PreviewPublicBookingPriceAsync(request);
        else await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Pricing.PreviewPublicBookingPriceAsync(request));
    }

    private sealed class Fixture(KoochDbContext db, Property property, RoomType room) : IAsyncDisposable
    {
        public static readonly DateOnly CheckIn = new(2035, 2, 1);
        public KoochDbContext Db { get; } = db;
        public Property Property { get; } = property;
        public RoomType Room { get; } = room;
        public ReservationPricingService Pricing { get; } = CreatePricing(db);
        private static ReservationPricingService CreatePricing(KoochDbContext db)
        {
            var resolver = new ChildPricingRuleResolver(db);
            return new(db, new PricingService(), resolver, new ReservationRulesResolver(db, resolver));
        }
        public static async Task<Fixture> CreateAsync()
        {
            var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
            var property = new Property { Id = 1, Name = "Property", Slug = "property",
                FreeChildAgeLimit = 5, ChildPrice = 50, ExtraGuestPrice = 30 };
            var room = new RoomType { Id = 10, PropertyId = 1, Name = "Room", Slug = "room",
                MaxAdults = 2, MaxChildren = 2, BasePrice = 100, IsActive = true };
            db.Properties.Add(property);
            db.RoomTypes.Add(room);
            db.SiteSettings.Add(new SiteSetting { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey,
                Value = "12", IsActive = true });
            db.RoomDailyPrices.AddRange(Enumerable.Range(0, 2).Select(day => new RoomDailyPrice
            {
                RoomTypeId = 10, Date = CheckIn.AddDays(day), GuestType = PricingGuestType.Iranian, BasePrice = 100
            }));
            await db.SaveChangesAsync();
            return new(db, property, room);
        }
        public ReservationPricePreviewRequest Request(int adults, int[] ages) => new()
        {
            PropertyId = 1, RoomTypeId = 10, CheckInDate = CheckIn, CheckOutDate = CheckIn.AddDays(2),
            Adults = adults, Children = ages.Length, ChildAges = ages, RoomCount = 1
        };
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
