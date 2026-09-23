using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class StayXGetOneFreePromotionTests
{
    private static readonly DateOnly Start = new(2035, 2, 1);
    private readonly PricingService pricing = new();

    [Theory]
    [InlineData(3, 0)]
    [InlineData(4, 1)]
    [InlineData(5, 1)]
    [InlineData(8, 1)]
    [InlineData(12, 1)]
    public void Threshold_GivesAtMostOneNight(int count, int freeNights)
    {
        var result = Calculate(Enumerable.Repeat(100m, count).ToArray(), FreeNight());
        Assert.Equal(freeNights, result.Count(night => night.FinalPrice == 0));
        Assert.Equal(count * 100m - freeNights * 100m, result.Sum(night => night.FinalPrice));
        Assert.Equal(freeNights, result.Sum(night => night.AppliedPromotions.Count));
    }

    [Fact]
    public void DifferentPrices_SelectCheapestActualNight()
    {
        var result = Calculate([4000000m, 3500000m, 5000000m, 4500000m], FreeNight());
        Assert.Equal([4000000m, 0m, 5000000m, 4500000m], result.Select(night => night.FinalPrice));
        Assert.Equal(3500000m, Assert.Single(result[1].AppliedPromotions).DiscountAmount);
    }

    [Fact]
    public void EarlierPromotionChangesSelection_LaterPromotionStillApplies_InSortOrderThenIdOrder()
    {
        var earlier = Promotion(1, PromotionType.FixedAmountDiscount);
        earlier.Amount = 120;
        earlier.StartDate = earlier.EndDate = Start.AddDays(1);
        var free = FreeNight(); // Id 2, same SortOrder as earlier.
        var later = Promotion(3, PromotionType.PercentageDiscount);
        later.Percentage = 10;
        later.SortOrder = 1;

        var result = Calculate([100m, 200m, 300m, 400m], later, free, earlier);

        Assert.Equal([90m, 0m, 270m, 360m], result.Select(night => night.FinalPrice));
        Assert.Equal([1, 2, 3], result[1].AppliedPromotions.Select(item => item.PromotionId));
        Assert.Equal([120m, 80m, 0m], result[1].AppliedPromotions.Select(item => item.DiscountAmount));
    }

    [Fact]
    public void EqualPrices_UseFirstEligibleNightInInputOrder()
    {
        var result = Calculate([100m, 100m, 100m, 100m], FreeNight());
        Assert.Equal([0m, 100m, 100m, 100m], result.Select(night => night.FinalPrice));
    }

    [Fact]
    public void AlreadyFreeCheapestNightDoesNotGiveAnAdditionalNight()
    {
        var earlier = Promotion(1, PromotionType.PercentageDiscount);
        earlier.Percentage = 100;
        earlier.EndDate = Start;
        var result = Calculate([100m, 200m, 300m, 400m], earlier, FreeNight());
        Assert.Equal([0m, 200m, 300m, 400m], result.Select(night => night.FinalPrice));
        Assert.Equal(0, Assert.Single(result[0].AppliedPromotions, item => item.PromotionId == 2).DiscountAmount);
    }

    [Fact]
    public void OneNightThresholdIsValid_AndExistingEnumValuesAreStable()
    {
        var free = FreeNight();
        free.MinimumStayNights = 1;
        Assert.Equal(0, Assert.Single(Calculate([100m], free)).FinalPrice);
        Assert.Equal(0, (int)PromotionType.PercentageDiscount);
        Assert.Equal(1, (int)PromotionType.FixedAmountDiscount);
        Assert.Equal(2, (int)PromotionType.LastMinute);
        Assert.Equal(3, (int)PromotionType.Informational);
    }

    [Fact]
    public void OnlyEligibleDatesAndWeekdaysCanBeFree()
    {
        var free = FreeNight();
        free.StartDate = Start.AddDays(1);
        free.Weekdays = PromotionService.ToWeekdayMask([Start.AddDays(2).DayOfWeek]);
        var result = Calculate([1m, 2m, 300m, 400m], free);
        Assert.Equal([1m, 2m, 0m, 400m], result.Select(night => night.FinalPrice));
    }

    [Fact]
    public void InactiveOrUnassignedPromotionsDoNotApply()
    {
        var free = FreeNight();
        free.IsActive = false;
        Assert.All(Calculate([100m, 100m, 100m, 100m], free), night => Assert.Empty(night.AppliedPromotions));
        free.IsActive = true;
        free.PromotionRoomTypes.Clear();
        Assert.All(Calculate([100m, 100m, 100m, 100m], free), night => Assert.Empty(night.AppliedPromotions));
    }

    [Theory]
    [InlineData(PromotionType.PercentageDiscount, 90, 180)]
    [InlineData(PromotionType.FixedAmountDiscount, 75, 175)]
    [InlineData(PromotionType.LastMinute, 90, 180)]
    [InlineData(PromotionType.Informational, 100, 200)]
    public void ExistingTypesRetainNightlyAmounts(PromotionType type, decimal first, decimal second)
    {
        var promotion = Promotion(1, type);
        promotion.Percentage = 10;
        promotion.Amount = 25;
        promotion.LastMinuteDays = 10;
        var result = Calculate([100m, 200m], promotion);
        Assert.Equal([first, second], result.Select(night => night.FinalPrice));
        for (var index = 0; index < result.Count; index++)
        {
            var singleNight = pricing.CalculateFinalPrice(result[index].BasePrice, 20,
                Start.AddDays(index), Start.AddDays(-1), [promotion]);
            Assert.Equal(singleNight.FinalPrice, result[index].FinalPrice);
            Assert.Equal(singleNight.AppliedPromotions, result[index].AppliedPromotions);
        }
    }

    [Fact]
    public void FixedAmountStillValidatesOriginalBaseAndClampsRemainingAmount()
    {
        var percentage = Promotion(1, PromotionType.PercentageDiscount);
        percentage.Percentage = 90;
        var amount = Promotion(3, PromotionType.FixedAmountDiscount);
        amount.Amount = 50;
        var result = Calculate([100m, 100m, 100m, 100m], amount, FreeNight(), percentage);
        Assert.All(result, night => Assert.Equal(0, night.FinalPrice));
        Assert.Equal(10, Assert.Single(result[0].AppliedPromotions, item => item.PromotionId == 2).DiscountAmount);
        amount.Amount = 101;
        Assert.Throws<ArgumentException>(() => Calculate([100m], amount));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task CreateRejectsInvalidThresholdWithoutPersisting(int? threshold)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var service = CreatePromotionService(harness);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(
            1, UserRole.SuperAdmin, null, Request(threshold)));
        Assert.Empty(await harness.DbContext.Promotions.ToListAsync());
    }

    [Fact]
    public async Task CreateAndEditReuseMinimumStayNightsAndClearIrrelevantValues()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var service = CreatePromotionService(harness);
        var request = Request(4);
        request.Amount = 300;
        request.Percentage = 50;
        request.LastMinuteDays = 2;
        var created = await service.CreateAsync(1, UserRole.SuperAdmin, null, request);
        Assert.Equal(PromotionType.StayXGetOneFree, created.Type);
        Assert.Equal(4, created.MinimumStayNights);
        Assert.Null(created.Amount);
        Assert.Null(created.Percentage);
        Assert.Null(created.LastMinuteDays);
        request.MinimumStayNights = 6;
        var updated = await service.UpdateAsync(1, UserRole.SuperAdmin, null, created.Id, request);
        Assert.Equal(6, updated.MinimumStayNights);
        request.MinimumStayNights = 0;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateAsync(
            1, UserRole.SuperAdmin, null, created.Id, request));
        Assert.Equal(6, (await harness.DbContext.Promotions.SingleAsync()).MinimumStayNights);
    }

    [Fact]
    public async Task PublicPreviewAndFinalReservationPersistTheSameDiscount_IncludingExtraGuestCharges()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var db = harness.DbContext;
        var property = await db.Properties.SingleAsync();
        var roomType = await db.RoomTypes.SingleAsync(room => room.Id == 20);
        roomType.AllowExtraGuest = true;
        roomType.MaxExtraGuests = 1;
        property.ExtraGuestPrice = 20;
        decimal[] amounts = [100, 80, 120, 110];
        for (var index = 0; index < amounts.Length; index++)
            db.RoomDailyPrices.Add(new RoomDailyPrice
            {
                RoomTypeId = 20, Date = Start.AddDays(index),
                GuestType = PricingGuestType.Iranian, BasePrice = amounts[index]
            });
        var free = FreeNight();
        free.PropertyId = 10;
        db.Promotions.Add(free);
        await db.SaveChangesAsync();
        var childRules = new ChildPricingRuleResolver(db);
        var reservationPricing = new ReservationPricingService(db, pricing, childRules,
            new ReservationRulesResolver(db, childRules));
        var preview = await reservationPricing.PreviewPublicBookingPriceAsync(new ReservationPricePreviewRequest
        {
            PropertyId = 10, RoomTypeId = 20, CheckInDate = Start, CheckOutDate = Start.AddDays(4),
            Adults = 3, RoomCount = 1
        });
        Assert.Equal(100, preview.DiscountAmount);
        Assert.Equal(390, preview.FinalAmount);
        Assert.Equal(80, preview.ExtraGuestAmount);
        Assert.Equal(0, preview.Nights[1].FinalAmount);

        var service = new ReservationService(db,
            new ReservationAvailabilityService(db, harness.EffectiveAvailability), reservationPricing,
            new StubReservationNumberGenerator(), new RecordingNotificationService(),
            new RecordingReservationNotificationDispatcher(), harness.AuditLogService,
            new StubPermissionService(true), new StubPropertyAuthorizationService(true),
            new ReservationStatusWorkflow(), harness.EffectiveAvailability, new TestHostEnvironment());
        var response = await service.CreateAsync(new ReservationCreateRequest
        {
            PropertyId = 10, RoomId = 30, GuestId = 40,
            CheckInDate = Start, CheckOutDate = Start.AddDays(4), Adults = 3
        }, harness.SuperAdmin);
        db.ChangeTracker.Clear();
        var persisted = await db.Reservations.SingleAsync(item => item.Id == response.Id);
        Assert.Equal(preview.FinalAmount, persisted.FinalAmount);
        Assert.Equal(preview.FinalAmount, persisted.TotalPrice);
        Assert.Equal(preview.DiscountAmount, persisted.DiscountAmount);
        Assert.Equal(preview.BaseAmount, persisted.BaseAmount);
        Assert.Equal(preview.Currency, persisted.Currency);
    }

    private IReadOnlyList<PromotionPriceResult> Calculate(decimal[] prices, params Promotion[] promotions) =>
        pricing.CalculateStayPrices(prices.Select((price, index) => (Start.AddDays(index), price)).ToArray(),
            20, Start.AddDays(-1), promotions);

    private static Promotion FreeNight() => Promotion(2, PromotionType.StayXGetOneFree);

    private static Promotion Promotion(int id, PromotionType type) => new()
    {
        Id = id, Title = type.ToString(), Type = type, MinimumStayNights = 4,
        StartDate = Start, EndDate = Start.AddDays(30), IsActive = true,
        Weekdays = PromotionService.ToWeekdayMask(Enum.GetValues<DayOfWeek>()),
        PromotionRoomTypes = [new PromotionRoomType { RoomTypeId = 20 }]
    };

    private static PromotionUpsertRequest Request(int? threshold) => new()
    {
        Title = "Stay X get one free", Type = PromotionType.StayXGetOneFree, MinimumStayNights = threshold,
        StartDate = Start, EndDate = Start.AddDays(30), Weekdays = Enum.GetValues<DayOfWeek>()
    };

    private static PromotionService CreatePromotionService(ReservationTestHarness harness)
    {
        var access = new PropertyAccessService(harness.DbContext);
        return new PromotionService(harness.DbContext, access, new PermissionService(harness.DbContext, access));
    }
}
