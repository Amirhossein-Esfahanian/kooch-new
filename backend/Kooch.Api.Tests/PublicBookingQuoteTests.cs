using Kooch.Api.Dtos.Properties;
using Kooch.Api.Controllers;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class PublicBookingOptionsTests
{
    [Fact]
    public void Quote_UsesPublicBookingRoute()
    {
        var method = typeof(PublicPropertiesController).GetMethod(
            nameof(PublicPropertiesController.QuoteBooking));
        Assert.NotNull(method);
        var route = Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true)
            .Cast<HttpPostAttribute>());
        Assert.Equal("{slug}/booking-quote", route.Template);
    }

    private static PublicBookingQuoteRequest QuoteRequest(
        int adults, IReadOnlyList<int> childAges, params PublicBookingQuoteSelection[] selections) => new()
    {
        CheckInDate = new DateOnly(2035, 2, 1),
        CheckOutDate = new DateOnly(2035, 2, 3),
        Adults = adults,
        ChildAges = childAges,
        Selections = selections
    };

    private static PublicBookingQuoteSelection Select(int roomTypeId, int quantity, int? ratePlanId = null) =>
        new() { RoomTypeId = roomTypeId, Quantity = quantity, RatePlanId = ratePlanId };

    [Fact]
    public async Task Quote_TwoDoubleRooms_AllocatesFourAdultsAndDoesNotPersist()
    {
        await using var context = await CreatePricedContextAsync();
        context.Reservations.RemoveRange(context.Reservations);
        await context.SaveChangesAsync();

        var quote = await AuthoritativeService(context).QuoteAsync("public-property",
            QuoteRequest(4, [], Select(10, 2)));

        Assert.Equal([2, 2], quote.Rooms.Select(room => room.Adults));
        Assert.Equal([300m, 300m], quote.Rooms.Select(room => room.FinalAmount));
        Assert.Equal(600m, quote.TotalAmount);
        Assert.Equal("IRR", quote.Currency);
        Assert.Empty(context.BookingSessions);
        Assert.Empty(context.Reservations);
    }

    [Fact]
    public async Task Quote_MixedRoomTypesAndRatePlans_UsesSelectedOfferAndActualOccupants()
    {
        await using var context = await CreatePricedContextAsync();
        context.Reservations.RemoveRange(context.Reservations);
        (await context.Availabilities.SingleAsync()).Status = AvailabilityStatus.Available;
        context.RoomDailyPrices.AddRange(
            new RoomDailyPrice { RoomTypeId = 20, Date = new DateOnly(2035, 2, 1), GuestType = PricingGuestType.Iranian, BasePrice = 100 },
            new RoomDailyPrice { RoomTypeId = 20, Date = new DateOnly(2035, 2, 2), GuestType = PricingGuestType.Iranian, BasePrice = 100 });
        context.RatePlans.Add(Plan(51, "Alternative", -20));
        await context.SaveChangesAsync();

        var quote = await AuthoritativeService(context).QuoteAsync("public-property",
            QuoteRequest(5, [], Select(10, 2, 51), Select(20, 1)));

        Assert.Equal([10, 10, 20], quote.Rooms.Select(room => room.RoomTypeId));
        Assert.Equal([2, 2, 1], quote.Rooms.Select(room => room.Adults));
        Assert.Equal([51, 51, null], quote.Rooms.Select(room => room.RatePlanId));
        Assert.Equal([260m, 260m, 200m], quote.Rooms.Select(room => room.FinalAmount));
        Assert.Equal(720m, quote.TotalAmount);
    }

    [Fact]
    public async Task Quote_PropertyChildRules_AllocateEachChildOnceAndUseAuthoritativePricing()
    {
        await using var context = await CreatePricedContextAsync();
        context.Reservations.RemoveRange(context.Reservations);
        var property = await context.Properties.SingleAsync();
        property.FreeChildAgeLimit = 5;
        property.ChildPrice = 50;
        context.SiteSettings.Add(new SiteSetting
        {
            Key = Kooch.Api.Services.ChildPricingRuleResolver.HalfPriceChildMaxAgeKey,
            Value = "12", IsActive = true
        });
        await context.SaveChangesAsync();

        var quote = await AuthoritativeService(context).QuoteAsync("public-property",
            QuoteRequest(2, [4, 8, 13], Select(10, 2)));

        Assert.Equal(2, quote.Rooms.Sum(room => room.Adults));
        Assert.Equal([4, 8, 13], quote.Rooms.SelectMany(room => room.ChildAges).Order());
        Assert.Equal(700m, quote.TotalAmount);
    }

    [Fact]
    public async Task Quote_HigherCapacityRoomCanHoldSmallerParty()
    {
        await using var context = await CreatePricedContextAsync();
        (await context.RoomTypes.SingleAsync(room => room.Id == 10)).MaxAdults = 4;
        await context.SaveChangesAsync();

        var quote = await AuthoritativeService(context).QuoteAsync("public-property",
            QuoteRequest(2, [], Select(10, 1)));

        Assert.Equal(2, Assert.Single(quote.Rooms).Adults);
        Assert.Equal(300m, quote.TotalAmount);
    }

    [Fact]
    public async Task Quote_RejectsInsufficientCapacityInventoryAndAdultFreeRooms()
    {
        await using var context = await CreatePricedContextAsync();
        var service = AuthoritativeService(context);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.QuoteAsync("public-property",
            QuoteRequest(4, [], Select(10, 2))));
        context.Reservations.RemoveRange(context.Reservations);
        await context.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.QuoteAsync("public-property",
            QuoteRequest(5, [], Select(10, 2))));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.QuoteAsync("public-property",
            QuoteRequest(1, [], Select(10, 2))));
    }

    [Fact]
    public async Task Quote_RejectsUnavailableRatePlan_AndLeavesLegacyOptionsUnchanged()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.Add(Plan(51, "Inactive", 0, isActive: false));
        await context.SaveChangesAsync();
        var service = AuthoritativeService(context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.QuoteAsync("public-property",
            QuoteRequest(1, [], Select(10, 1, 51))));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.QuoteAsync("public-property",
            QuoteRequest(1, [], Select(10, 1, 999))));
        var options = await service.GetAsync("public-property", new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3), 1, 0, []);
        var standard = Assert.Single(options.RoomTypes, room => room.RoomTypeId == 10);
        Assert.Equal(300m, standard.FinalAmount);
        Assert.Empty(standard.RatePlans);
    }

    [Fact]
    public async Task Quote_RejectsRatePlanMinimumNightsAndMixedBookingModes()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.Add(Plan(51, "Long stay", 0, minimumNights: 3));
        await context.SaveChangesAsync();
        var service = AuthoritativeService(context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.QuoteAsync("public-property",
            QuoteRequest(1, [], Select(10, 1, 51))));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.QuoteAsync("public-property",
            QuoteRequest(2, [], Select(10, 1), Select(20, 1))));
    }

    [Fact]
    public async Task Quote_StandardAndRatePlanShareRoomTypeInventory()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.Add(Plan(51, "Alternative", -20));
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            AuthoritativeService(context).QuoteAsync("public-property",
                QuoteRequest(2, [], Select(10, 1), Select(10, 1, 51))));
    }
}
