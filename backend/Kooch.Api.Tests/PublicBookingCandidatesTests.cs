using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class PublicBookingOptionsTests
{
    [Fact]
    public void MultiRoomCandidates_HaveTheirOwnPublicReadRoute()
    {
        var method = typeof(PublicPropertiesController).GetMethod(
            nameof(PublicPropertiesController.GetBookingCandidates));
        Assert.NotNull(method);
        var route = Assert.Single(method.GetCustomAttributes(typeof(HttpGetAttribute), true)
            .Cast<HttpGetAttribute>());
        Assert.Equal("{slug}/booking-options/candidates", route.Template);
    }

    [Fact]
    public async Task MultiRoomCandidates_FourAdultsCanDiscoverTwoPersonAndMixedRoomTypes()
    {
        await using var context = await CreatePricedContextAsync();
        context.RoomDailyPrices.AddRange(
            new RoomDailyPrice { RoomTypeId = 20, Date = new DateOnly(2035, 2, 1), GuestType = PricingGuestType.Iranian, BasePrice = 100 },
            new RoomDailyPrice { RoomTypeId = 20, Date = new DateOnly(2035, 2, 2), GuestType = PricingGuestType.Iranian, BasePrice = 100 });
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 2, 4, 0, []);

        Assert.True(response.RequiresBookingQuote);
        Assert.Equal(2, response.Rooms);
        Assert.Equal([10, 20], response.RoomTypes.Select(room => room.RoomTypeId));
        Assert.Equal([1, 2], response.RoomTypes.Select(room => room.AvailableCount));
        Assert.All(response.RoomTypes, room => Assert.Equal(2, room.MaxAdults));
    }

    [Fact]
    public async Task MultiRoomCandidates_ExposeEligiblePlansButNoStandalonePrices()
    {
        await using var context = await CreatePricedContextAsync();
        context.RatePlans.AddRange(
            Plan(51, "Eligible", -20),
            Plan(52, "Too short", 0, minimumNights: 3),
            Plan(53, "Inactive", 0, isActive: false),
            Plan(54, "Nonpositive", -200));
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 2, 4, 0, []);

        var room = Assert.Single(response.RoomTypes, option => option.RoomTypeId == 10);
        Assert.Equal(51, Assert.Single(room.RatePlans).RatePlanId);
        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("finalAmount", json);
        Assert.DoesNotContain("currency", json);
        Assert.DoesNotContain("totalAmount", json);
    }

    [Fact]
    public async Task MultiRoomCandidates_KeepChildAgesAndPropertyOverridesForTheCombinedQuote()
    {
        await using var context = await CreatePricedContextAsync();
        var property = await context.Properties.SingleAsync();
        property.FreeChildAgeLimit = 5;
        property.MaxFreeChildren = 1;
        property.ChildPrice = 50;
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3),
            2, 4, 3, [4, 8, 13]);

        Assert.Equal([4, 8, 13], response.ChildAges);
        Assert.Contains(response.RoomTypes, room => room.RoomTypeId == 10);
        await Assert.ThrowsAsync<ArgumentException>(() => AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3),
            2, 4, 1, [18]));
    }

    [Fact]
    public async Task MultiRoomCandidates_HigherCapacityRoomRemainsDiscoverable()
    {
        await using var context = await CreatePricedContextAsync();
        (await context.RoomTypes.SingleAsync(room => room.Id == 10)).MaxAdults = 4;
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 2, 4, 0, []);

        Assert.Equal(4, Assert.Single(response.RoomTypes, room => room.RoomTypeId == 10).MaxAdults);
    }

    [Fact]
    public async Task MultiRoomCandidates_ExcludeUnavailableRooms()
    {
        await using var context = await CreatePricedContextAsync();
        (await context.Availabilities.SingleAsync()).Status = AvailabilityStatus.Unavailable;
        context.Reservations.Add(new Reservation
        {
            ReservationNumber = "KCH-HOLD-2", ClientId = 1, GuestId = 1,
            PropertyId = 1, RoomTypeId = 10, RoomId = 101,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3), AdultCount = 1,
            Currency = "IRR", Status = ReservationStatus.ApprovedAwaitingPayment
        });
        await context.SaveChangesAsync();

        var response = await AuthoritativeService(context).GetCandidatesAsync(
            "public-property", new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 2, 4, 0, []);

        Assert.Empty(response.RoomTypes);
    }

    [Fact]
    public async Task MultiRoomCandidates_DoNotChangeLegacySingleRoomResults()
    {
        await using var context = await CreatePricedContextAsync();
        var service = AuthoritativeService(context);

        var legacy = await service.GetAsync("public-property",
            new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 4, 0, []);
        var candidates = await service.GetCandidatesAsync("public-property",
            new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 2, 4, 0, []);
        var pricedLegacy = await service.GetAsync("public-property",
            new DateOnly(2035, 2, 1), new DateOnly(2035, 2, 3), 1, 0, []);

        Assert.DoesNotContain(legacy.RoomTypes, room => room.RoomTypeId == 10);
        Assert.Contains(candidates.RoomTypes, room => room.RoomTypeId == 10);
        Assert.Equal(300m, Assert.Single(pricedLegacy.RoomTypes, room => room.RoomTypeId == 10).FinalAmount);
    }
}
