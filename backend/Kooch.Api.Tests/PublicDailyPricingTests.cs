using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicDailyPricingTests
{
    private static readonly DateOnly CheckIn = new(2035, 2, 1);
    private static readonly DateOnly CheckOut = new(2035, 2, 3);

    [Fact]
    public async Task CompleteDailyPrices_AreTheOnlySourceForPublicPricing()
    {
        await using var context = await CreateContextAsync(basePrice: null);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        await context.SaveChangesAsync();

        var result = await CreateService(context).PreviewPublicBookingPriceAsync(Request());

        Assert.Equal(300, result.BaseAmount);
        Assert.Equal(300, result.FinalAmount);
        Assert.Equal([120m, 180m], result.Nights.Select(night => night.BasePrice));
    }

    [Theory]
    [InlineData(-20, 260)]
    [InlineData(0, 300)]
    [InlineData(30, 360)]
    public async Task FixedRatePlan_AdjustsEachDifferentNightOnce(decimal modifier, decimal expected)
    {
        await using var context = await CreateContextAsync(basePrice: 900);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        AddPlan(context, 50, 10, modifier);
        await context.SaveChangesAsync();

        var request = Request();
        request.RatePlanId = 50;
        var result = await CreateService(context).PreviewPublicBookingPriceAsync(request);

        Assert.Equal(expected, result.BaseAmount);
        Assert.Equal(expected, result.FinalAmount);
        Assert.Equal([120m + modifier, 180m + modifier], result.Nights.Select(night => night.BasePrice));
    }

    [Fact]
    public async Task FixedRatePlan_DoesNotMultiplyByGuestsOrChangeExtraGuestCharge()
    {
        await using var context = await CreateContextAsync(basePrice: null);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        AddPlan(context, 50, 10, -20);
        var roomType = await context.RoomTypes.SingleAsync();
        roomType.AllowExtraGuest = true;
        roomType.MaxExtraGuests = 1;
        (await context.Properties.SingleAsync()).ExtraGuestPrice = 15;
        await context.SaveChangesAsync();

        var request = Request();
        request.RatePlanId = 50;
        request.Adults = 3;
        var result = await CreateService(context).PreviewPublicBookingPriceAsync(request);

        Assert.Equal(260, result.BaseAmount);
        Assert.Equal(30, result.ExtraGuestAmount);
        Assert.Equal(290, result.FinalAmount);
        Assert.Equal([15m, 15m], result.Nights.Select(night => night.ExtraGuestAmount));
    }

    [Theory]
    [InlineData(-120)]
    [InlineData(-121)]
    public async Task FixedRatePlan_RejectsNonPositiveEffectiveNight(decimal modifier)
    {
        await using var context = await CreateContextAsync(basePrice: null);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        AddPlan(context, 50, 10, modifier);
        await context.SaveChangesAsync();
        var request = Request();
        request.RatePlanId = 50;

        var error = await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(context).PreviewPublicBookingPriceAsync(request));
        Assert.Contains(CheckIn.ToString("yyyy-MM-dd"), error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PricingBoundary_RejectsUnavailableOrIncompatibleRatePlans()
    {
        await using var context = await CreateContextAsync(basePrice: null);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Deleted", Slug = "deleted", IsDeleted = true });
        AddPlan(context, 50, 20, 0);
        AddPlan(context, 51, 10, 0, isActive: false);
        AddPlan(context, 52, 10, 0, isDeleted: true);
        AddPlan(context, 53, 10, 0, type: PriceModifierType.Percentage);
        AddPlan(context, 54, 10, 0, mealPlanId: 70);
        await context.SaveChangesAsync();

        foreach (var id in new[] { 50, 51, 52, 53, 54, 999 })
        {
            var request = Request();
            request.RatePlanId = id;
            if (id is 52 or 999)
                await Assert.ThrowsAsync<KeyNotFoundException>(() => CreateService(context).PreviewPublicBookingPriceAsync(request));
            else
                await Assert.ThrowsAsync<ArgumentException>(() => CreateService(context).PreviewPublicBookingPriceAsync(request));
        }
    }

    [Fact]
    public async Task Promotion_AppliesAfterRatePlanAdjustedRoomBase()
    {
        await using var context = await CreateContextAsync(basePrice: null);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 180);
        AddPlan(context, 50, 10, 20);
        context.Promotions.Add(new Promotion
        {
            Title = "Ten percent", Type = PromotionType.PercentageDiscount, Percentage = 10,
            StartDate = CheckIn, EndDate = CheckOut, IsActive = true,
            Weekdays = PromotionService.ToWeekdayMask(Enum.GetValues<DayOfWeek>()),
            PromotionRoomTypes = [new PromotionRoomType { RoomTypeId = 10 }]
        });
        await context.SaveChangesAsync();
        var request = Request();
        request.RatePlanId = 50;

        var result = await CreateService(context).PreviewPublicBookingPriceAsync(request);
        Assert.Equal(340, result.BaseAmount);
        Assert.Equal(34, result.DiscountAmount);
        Assert.Equal(306, result.FinalAmount);
    }

    [Fact]
    public async Task MissingDailyPrice_IsRejectedEvenWhenLegacyBasePriceExists()
    {
        await using var context = await CreateContextAsync(basePrice: 900);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        await context.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<IncompleteDailyPricingException>(
            () => CreateService(context).PreviewPublicBookingPriceAsync(Request()));

        Assert.Equal(10, exception.RoomTypeId);
        Assert.Equal([CheckIn.AddDays(1)], exception.UnavailableDates);
    }

    [Fact]
    public async Task ZeroDailyPrice_IsRejectedForPublicBooking()
    {
        await using var context = await CreateContextAsync(basePrice: 900);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 120);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 0);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<IncompleteDailyPricingException>(
            () => CreateService(context).PreviewPublicBookingPriceAsync(Request()));
    }

    [Fact]
    public async Task SelectedGuestType_DoesNotFallbackToAnotherGuestType()
    {
        await using var context = await CreateContextAsync(basePrice: 900);
        AddPrice(context, CheckIn, PricingGuestType.Iranian, 100);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Iranian, 100);
        AddPrice(context, CheckIn, PricingGuestType.Foreign, 300);
        AddPrice(context, CheckIn.AddDays(1), PricingGuestType.Foreign, 400);
        await context.SaveChangesAsync();

        var foreign = await CreateService(context).PreviewPublicBookingPriceAsync(
            Request(PricingGuestType.Foreign));
        Assert.Equal(700, foreign.FinalAmount);

        context.RoomDailyPrices.Remove(
            await context.RoomDailyPrices.SingleAsync(price =>
                price.Date == CheckIn.AddDays(1) &&
                price.GuestType == PricingGuestType.Foreign));
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<IncompleteDailyPricingException>(
            () => CreateService(context).PreviewPublicBookingPriceAsync(
                Request(PricingGuestType.Foreign)));
    }

    [Fact]
    public async Task LegacyPreview_KeepsBasePriceCompatibilityOutsidePublicBooking()
    {
        await using var context = await CreateContextAsync(basePrice: 250);

        var result = await CreateService(context).PreviewReservationPriceAsync(Request());

        Assert.Equal(500, result.FinalAmount);
    }

    [Fact]
    public async Task PricingCalendar_UsesTheStoredRoomTypeNameAndDoesNotMaterializeLegacyBasePrice()
    {
        await using var context = await CreateContextAsync(basePrice: 900);
        var service = new RoomDailyPriceService(
            context,
            new PropertyAccessService(context),
            null!);

        var result = await service.GetAsync(
            1,
            UserRole.SuperAdmin,
            1,
            CheckIn,
            CheckOut,
            PricingGuestType.Iranian);

        var roomType = Assert.Single(result.RoomTypes);
        Assert.Equal("شاه‌نشین", roomType.Name);
        Assert.All(roomType.Days, day => Assert.Equal(0, day.BasePrice));
    }

    private static ReservationPricingService CreateService(KoochDbContext context)
    {
        var childRules = new ChildPricingRuleResolver(context);
        return new ReservationPricingService(
            context,
            new PricingService(),
            childRules,
            new ReservationRulesResolver(context, childRules));
    }

    private static ReservationPricePreviewRequest Request(
        PricingGuestType guestType = PricingGuestType.Iranian) =>
        new()
        {
            PropertyId = 1,
            RoomTypeId = 10,
            CheckInDate = CheckIn,
            CheckOutDate = CheckOut,
            Adults = 1,
            GuestType = guestType
        };

    private static void AddPrice(
        KoochDbContext context,
        DateOnly date,
        PricingGuestType guestType,
        decimal amount) =>
        context.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = 10,
            Date = date,
            GuestType = guestType,
            BasePrice = amount
        });

    private static void AddPlan(KoochDbContext context, int id, int roomTypeId, decimal modifier,
        bool isActive = true, bool isDeleted = false,
        PriceModifierType type = PriceModifierType.FixedAmount, int? mealPlanId = null) =>
        context.RatePlans.Add(new RatePlan
        {
            Id = id, RoomTypeId = roomTypeId, Name = $"Plan {id}", MealPlanId = mealPlanId,
            PriceModifierType = type, PriceModifierValue = modifier,
            IsActive = isActive, IsDeleted = isDeleted
        });

    private static async Task<KoochDbContext> CreateContextAsync(decimal? basePrice)
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"public-daily-pricing-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);
        context.Users.Add(new User
        {
            Id = 1,
            FirstName = "Admin",
            LastName = "User",
            PasswordHash = "hash",
            Role = UserRole.SuperAdmin,
            IsActive = true
        });
        context.Properties.Add(new Property
        {
            Id = 1,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Daily pricing property",
            Slug = "daily-pricing-property",
            Description = "Description",
            Address = "Address",
            City = "City",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        context.RoomTypes.Add(new RoomType
        {
            Id = 10,
            PropertyId = 1,
            Name = "شاه‌نشین",
            Slug = "shahneshin",
            Description = "Description",
            MaxAdults = 2,
            MaxChildren = 1,
            TotalInventory = 1,
            InventoryMode = InventoryMode.TypeBasedInventory,
            BasePrice = basePrice,
            IsActive = true
        });
        await context.SaveChangesAsync();
        return context;
    }
}
