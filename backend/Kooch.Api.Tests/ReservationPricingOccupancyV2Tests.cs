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
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(1)]
    public async Task FreeQuota_DoesNotChangeOccupancyOrMoneyInPhaseA(int? quota)
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.Property.MaxFreeChildren = quota;
        await fixture.Db.SaveChangesAsync();
        var quote = await fixture.Pricing.PreviewPublicBookingPriceAsync(fixture.Request(2, [4, 5]));
        Assert.Equal(200m, quote.FinalAmount);
        Assert.Equal(0m, quote.ChildAmount);
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
    [InlineData(1, 0, 200, 0, 0)]
    [InlineData(2, 0, 300, 100, 0)]
    [InlineData(3, 0, 360, 100, 60)]
    [InlineData(2, -10, 280, 100, 0)]
    public async Task ExistingChildExtraAndRatePlanMoney_RemainsUnchanged(
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
