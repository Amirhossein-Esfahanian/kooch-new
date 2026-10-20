using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Fact]
    public async Task StayGuests_PublicQuoteMatchesAccountBookingSessionPrices()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10);
        await using var quoteContext = harness.CreateContext();
        var childRules = new ChildPricingRuleResolver(quoteContext);
        var quoteService = new PublicBookingOptionsService(
            quoteContext, new EffectiveAvailabilityService(quoteContext),
            new ReservationPricingService(quoteContext, new PricingService(), childRules,
                new ReservationRulesResolver(quoteContext, childRules)), childRules,
            new PropertySameNightBookingPolicyService(TimeProvider.System));
        var quote = await quoteService.QuoteAsync("property-one", new PublicBookingQuoteRequest
        {
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            Adults = 4,
            Selections = [new PublicBookingQuoteSelection { RoomTypeId = 10, Quantity = 2 }]
        });

        await using var scope = harness.CreateService(useAuthoritativePricing: true);
        await scope.Service.CreateForAccountAsync(1,
            StayRequest(4, [], CreateAccountItem(10, 100), CreateAccountItem(10, null)));
        await using var verification = harness.CreateContext();
        var reservations = await verification.Reservations.OrderBy(item => item.Id).ToArrayAsync();

        Assert.Equal(reservations.Select(item => item.AdultCount), quote.Rooms.Select(room => room.Adults));
        Assert.Equal(reservations.Select(item => item.FinalAmount), quote.Rooms.Select(room => room.FinalAmount));
        Assert.Equal(reservations.Sum(item => item.FinalAmount), quote.TotalAmount);
    }

    [Fact]
    public async Task StayGuests_FourAdultsFitTwoTwoPersonRooms()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10);
        await using var scope = harness.CreateService(useAuthoritativePricing: true);
        var request = StayRequest(4, [], CreateAccountItem(10, 100), CreateAccountItem(10, null));
        request.Items[0].Adults = 99; // Per-item client counts are ignored in stay-level mode.

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(2, result.Reservations.Count);
        await using var verification = harness.CreateContext();
        var reservations = await verification.Reservations.OrderBy(item => item.Id).ToArrayAsync();
        Assert.Equal([2, 2], reservations.Select(item => item.AdultCount));
        Assert.Equal(4, reservations.Sum(item => item.AdultCount));
        Assert.Equal(400m, reservations.Sum(item => item.FinalAmount));
    }

    [Fact]
    public async Task StayGuests_TwoAdultsFitOneFourPersonRoom()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10);
        await using (var setup = harness.CreateContext())
        {
            (await setup.RoomTypes.SingleAsync(item => item.Id == 10)).MaxAdults = 4;
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService(useAuthoritativePricing: true);

        var result = await scope.Service.CreateForAccountAsync(1,
            StayRequest(2, [], CreateAccountItem(10, 100)));

        Assert.Single(result.Reservations);
        await using var verification = harness.CreateContext();
        Assert.Equal(2, (await verification.Reservations.SingleAsync()).AdultCount);
    }

    [Fact]
    public async Task StayGuests_MixedRoomTypesAndQuantities_UseActualOccupantsForPricing()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10, 20);
        await using var scope = harness.CreateService(useAuthoritativePricing: true);

        var result = await scope.Service.CreateForAccountAsync(1, StayRequest(5, [],
            CreateAccountItem(10, 100), CreateAccountItem(10, null), CreateAccountItem(20, 200)));

        Assert.Equal(3, result.Reservations.Count);
        await using var verification = harness.CreateContext();
        var reservations = await verification.Reservations.OrderBy(item => item.Id).ToArrayAsync();
        Assert.Equal([10, 10, 20], reservations.Select(item => item.RoomTypeId));
        Assert.Equal([2, 2, 1], reservations.Select(item => item.AdultCount));
        Assert.Equal(5, reservations.Sum(item => item.AdultCount));
        Assert.Equal(600m, reservations.Sum(item => item.FinalAmount));
    }

    [Fact]
    public async Task StayGuests_PropertyAgeRules_ChargeHalfPriceChildOnlyOnce()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10);
        await using (var setup = harness.CreateContext())
        {
            var property = await setup.Properties.SingleAsync(item => item.Id == 1);
            property.FreeChildAgeLimit = 5;
            property.ChildPrice = 50;
            setup.SiteSettings.Add(new SiteSetting
            {
                Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey,
                Value = "12",
                IsActive = true
            });
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService(useAuthoritativePricing: true);

        await scope.Service.CreateForAccountAsync(1, StayRequest(2, [4, 8, 13],
            CreateAccountItem(10, 100), CreateAccountItem(10, null)));

        await using var verification = harness.CreateContext();
        var reservations = await verification.Reservations.OrderBy(item => item.Id).ToArrayAsync();
        Assert.Equal(3, reservations.Sum(item => item.AdultCount));
        Assert.Equal(2, reservations.Sum(item => item.ChildCount));
        Assert.Equal(500m, reservations.Sum(item => item.FinalAmount));
        Assert.Equal([200m, 300m], reservations.Select(item => item.FinalAmount).Order());
    }

    [Fact]
    public async Task StayGuests_ImpossibleAggregateCapacityRejectsBeforePersistence()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, StayRequest(5, [],
                CreateAccountItem(10, 100), CreateAccountItem(10, null))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task StayGuests_ReplayKeepsOriginalAllocationAfterPropertyRuleChange()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await AddPublicDailyPricesAsync(harness, 10);
        var request = StayRequest(2, [4], CreateAccountItem(10, 100));
        await using var firstScope = harness.CreateService(useAuthoritativePricing: true);
        var first = await firstScope.Service.CreateForAccountAsync(1, request);
        await using (var setup = harness.CreateContext())
        {
            (await setup.Properties.SingleAsync(item => item.Id == 1)).FreeChildAgeLimit = 1;
            await setup.SaveChangesAsync();
        }
        await using var replayScope = harness.CreateService(useAuthoritativePricing: true);

        var replay = await replayScope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task StayGuests_SameKeyWithChangedPartyConflicts()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = StayRequest(2, [], CreateAccountItem(10, 100));
        await scope.Service.CreateForAccountAsync(1, request);
        request.StayGuests!.Adults = 1;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, request));

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    private static AccountBookingSessionCreateRequest StayRequest(
        int adults, IReadOnlyList<int> childAges,
        params AccountBookingSessionReservationCreateItem[] items)
    {
        var request = CreateAccountRequest(items);
        request.StayGuests = new AccountBookingSessionStayGuests
        {
            Adults = adults,
            ChildAges = childAges
        };
        return request;
    }

    private static async Task AddPublicDailyPricesAsync(
        BookingSessionTestHarness harness, params int[] roomTypeIds)
    {
        await using var setup = harness.CreateContext();
        foreach (var roomTypeId in roomTypeIds)
        {
            setup.RoomDailyPrices.AddRange(
                new RoomDailyPrice
                {
                    RoomTypeId = roomTypeId, Date = new DateOnly(2035, 2, 1),
                    GuestType = PricingGuestType.Iranian, BasePrice = 100
                },
                new RoomDailyPrice
                {
                    RoomTypeId = roomTypeId, Date = new DateOnly(2035, 2, 2),
                    GuestType = PricingGuestType.Iranian, BasePrice = 100
                });
        }
        await setup.SaveChangesAsync();
    }
}
