using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class DatedPropertySearchPricingTests
{
    [Theory]
    [InlineData(false, 2, 3, 0, 1, 2, false, "Available", PublicBookingDecisionReason.None)]
    [InlineData(false, 2, 3, 0, 1, 2, true, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(true, 1, 22, 59, 1, 1, false, "Available", PublicBookingDecisionReason.None)]
    [InlineData(true, 1, 23, 0, 1, 1, false, "OnRequest", PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(true, 1, 23, 30, 1, 2, false, "OnRequest", PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(true, 2, 1, 0, 1, 2, false, "OnRequest", PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(true, 2, 2, 0, 1, 2, false, null, PublicBookingDecisionReason.SameNightFinalCutoff)]
    [InlineData(true, 2, 2, 1, 1, 2, false, null, PublicBookingDecisionReason.SameNightFinalCutoff)]
    [InlineData(true, 1, 22, 59, 1, 2, true, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(true, 1, 23, 30, 1, 2, true, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(true, 2, 2, 0, 1, 2, true, null, PublicBookingDecisionReason.SameNightFinalCutoff)]
    [InlineData(true, 1, 23, 30, 2, 1, false, "Available", PublicBookingDecisionReason.None)]
    [InlineData(true, 2, 2, 0, 2, 1, false, "Available", PublicBookingDecisionReason.None)]
    public async Task SameNight_SearchAndOptionsAgreeForRequestedStay(
        bool configured, int nowDay, int hour, int minute, int checkInDay, int nights,
        bool calendarOnRequest, string? expected, PublicBookingDecisionReason reason)
    {
        var policy = new ObservedSearchPolicy(new SearchClock(nowDay, hour, minute));
        await using var fixture = await Fixture.CreateAsync(policy);
        if (configured) await ConfigureSearchPolicyAsync(fixture);
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        var checkIn = new DateOnly(2035, 2, checkInDay);
        var checkOut = checkIn.AddDays(nights);
        if (calendarOnRequest)
            fixture.Db.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = checkOut.AddDays(-1), AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
        await fixture.Db.SaveChangesAsync();

        var results = await fixture.FindAsync(checkIn, checkOut);
        Assert.Equal((1, checkIn), Assert.Single(policy.Calls));
        var options = await fixture.Options.GetAsync("priced-property", checkIn, checkOut, 2, 0, []);
        Assert.Equal(2, policy.Calls.Count);
        if (expected is null)
        {
            Assert.Empty(results);
            Assert.Empty(options.RoomTypes);
            Assert.Equal(PublicBookingUnavailableReason.SameNightFinalCutoff,
                Assert.Single(options.UnavailableRoomTypes).Reason);
            return;
        }

        var result = Assert.Single(results);
        Assert.Equal(expected, result.AvailabilityStatusSummary);
        Assert.Equal(expected == "Available", result.IsInstantBooking);
        Assert.Equal(reason, result.BookingDecisionReason);
        var option = Assert.Single(options.RoomTypes);
        Assert.Equal(expected == "Available" ? ReservationBookingModeFilter.Instant : ReservationBookingModeFilter.OnRequest,
            option.BookingMode);
        Assert.Equal(reason, option.BookingDecisionReason);
        var alternative = Assert.Single(option.RatePlans);
        Assert.Equal(option.FinalAmount - nights * 200_000m, alternative.FinalAmount);
        Assert.Equal(alternative.FinalAmount / nights, result.StartingPrice);
        var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        jsonOptions.Converters.Add(new JsonStringEnumConverter());
        var json = JsonSerializer.SerializeToElement(result, jsonOptions);
        Assert.Equal(reason.ToString(), json.GetProperty("bookingDecisionReason").GetString());
    }

    [Theory]
    [InlineData(false, false, true, false, "Available", PublicBookingDecisionReason.None)]
    [InlineData(false, true, false, false, "Available", PublicBookingDecisionReason.None)]
    [InlineData(false, true, true, false, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(true, false, false, false, "OnRequest", PublicBookingDecisionReason.SameNightApprovalRequired)]
    [InlineData(true, false, true, false, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(true, true, false, false, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    [InlineData(false, true, false, true, "OnRequest", PublicBookingDecisionReason.ExistingOnRequest)]
    public async Task SameNight_PropertyModeAggregatesOnlyPriceableQualifyingRoomTypes(
        bool afterInstant, bool firstOnRequest, bool secondOnRequest, bool secondUnpriceable,
        string expected, PublicBookingDecisionReason reason)
    {
        var policy = new ObservedSearchPolicy(new SearchClock(1, afterInstant ? 23 : 22, 30));
        await using var fixture = await Fixture.CreateAsync(policy);
        await ConfigureSearchPolicyAsync(fixture);
        fixture.Db.RoomTypes.Add(Room(20, 1_500_000));
        fixture.Db.RoomDailyPrices.Add(Daily(20, CheckIn, 1_500_000));
        if (!secondUnpriceable) fixture.Db.RoomDailyPrices.Add(Daily(20, CheckIn.AddDays(1), 1_500_000));
        foreach (var (roomId, onRequest) in new[] { (10, firstOnRequest), (20, secondOnRequest) })
            if (onRequest) fixture.Db.Availabilities.Add(new Availability
            {
                RoomTypeId = roomId, Date = CheckIn.AddDays(1), AvailableCount = 2, Status = AvailabilityStatus.OnRequest
            });
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.FindAsync());

        Assert.Single(policy.Calls);
        Assert.Equal(expected, result.AvailabilityStatusSummary);
        Assert.Equal(expected == "Available", result.IsInstantBooking);
        Assert.Equal(reason, result.BookingDecisionReason);
        Assert.Equal(secondUnpriceable ? 1 : 2, result.MatchingRoomTypesCount);
        Assert.Equal(secondUnpriceable ? 2_000_000m : 1_500_000m, result.StartingPrice);
    }

    [Theory]
    [InlineData("closed")]
    [InlineData("unavailable")]
    [InlineData("zero")]
    [InlineData("consumed")]
    public async Task SameNight_DoesNotRelaxExistingFullStayAvailability(string cause)
    {
        var policy = new ObservedSearchPolicy(new SearchClock(1, 23, 30));
        await using var fixture = await Fixture.CreateAsync(policy);
        await ConfigureSearchPolicyAsync(fixture);
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        if (cause == "consumed")
        {
            (await fixture.Db.RoomTypes.SingleAsync()).TotalInventory = 1;
            fixture.Db.Reservations.Add(new Reservation
            {
                PropertyId = 1, RoomTypeId = 10, ClientId = 1, ReservationNumber = "R-123456",
                CheckInDate = CheckIn, CheckOutDate = CheckOut, Status = ReservationStatus.Confirmed
            });
        }
        else fixture.Db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = CheckIn.AddDays(1), IsClosed = cause == "closed",
            AvailableCount = cause == "zero" ? 0 : 2,
            Status = cause == "unavailable" ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available
        });
        await fixture.Db.SaveChangesAsync();

        Assert.Empty(await fixture.FindAsync());
    }

    [Fact]
    public async Task SameNight_ApprovalDowngradeChangesNeitherStandardNorRatePlanMoney()
    {
        var clock = new SearchClock(1, 22, 59);
        var policy = new ObservedSearchPolicy(clock);
        await using var fixture = await Fixture.CreateAsync(policy);
        await ConfigureSearchPolicyAsync(fixture);
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        await fixture.Db.SaveChangesAsync();
        var before = Assert.Single(await fixture.FindAsync());
        var beforeQuote = Assert.Single((await fixture.Options.GetAsync("priced-property", CheckIn, CheckOut, 2, 0, [])).RoomTypes);

        clock.Set(1, 23, 0);
        var after = Assert.Single(await fixture.FindAsync());
        var afterQuote = Assert.Single((await fixture.Options.GetAsync("priced-property", CheckIn, CheckOut, 2, 0, [])).RoomTypes);

        Assert.Equal("Available", before.AvailabilityStatusSummary);
        Assert.Equal("OnRequest", after.AvailabilityStatusSummary);
        Assert.Equal(before.StartingPrice, after.StartingPrice);
        Assert.Equal(2_000_000m, after.StartingPrice);
        Assert.Equal(beforeQuote.FinalAmount, afterQuote.FinalAmount);
        Assert.Equal(4_400_000m, afterQuote.FinalAmount);
        Assert.Equal(Assert.Single(beforeQuote.RatePlans).FinalAmount, Assert.Single(afterQuote.RatePlans).FinalAmount);
        Assert.Equal(4_000_000m, Assert.Single(afterQuote.RatePlans).FinalAmount);
    }

    [Fact]
    public async Task SameNight_OneEvaluationPerProperty_NotPerRoomTypePlanOrNight()
    {
        var policy = new ObservedSearchPolicy(new SearchClock(2, 2, 0));
        await using var fixture = await Fixture.CreateAsync(policy);
        await ConfigureSearchPolicyAsync(fixture);
        fixture.Db.RoomTypes.Add(Room(20, 1_500_000));
        fixture.Db.RoomDailyPrices.AddRange(Daily(20, CheckIn, 1_500_000), Daily(20, CheckIn.AddDays(1), 1_500_000));
        fixture.Db.RatePlans.AddRange(Plan(51, -200_000), Plan(52, 200_000));
        fixture.Db.Properties.Add(new Property
        {
            Id = 2, OwnerId = 1, DestinationId = 1, Name = "Other property", Slug = "other-property",
            Status = PropertyStatus.Approved, City = "City", Country = "IR", Description = "Other", Address = "Address"
        });
        var otherRoom = Room(30, 3_000_000);
        otherRoom.PropertyId = 2;
        fixture.Db.RoomTypes.Add(otherRoom);
        fixture.Db.RoomDailyPrices.AddRange(Daily(30, CheckIn, 3_000_000), Daily(30, CheckIn.AddDays(1), 3_000_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.FindAsync());

        Assert.Equal(2, result.Id);
        Assert.Equal("Available", result.AvailabilityStatusSummary);
        Assert.Equal(3_000_000m, result.StartingPrice);
        Assert.Equal(new[] { (1, CheckIn), (2, CheckIn) }, policy.Calls.OrderBy(call => call.PropertyId));
    }

    [Fact]
    public async Task SameNight_UndatedSearchRemainsNeutralWithNinetyDayStandardTeaser()
    {
        var policy = new ObservedSearchPolicy(new SearchClock(2, 2, 0));
        await using var fixture = await Fixture.CreateAsync(policy);
        await ConfigureSearchPolicyAsync(fixture);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        fixture.Db.RoomDailyPrices.AddRange(Daily(10, today, 500_000), Daily(10, today.AddDays(90), 1));
        fixture.Db.RatePlans.Add(Plan(51, -200_000));
        await fixture.Db.SaveChangesAsync();

        var result = Assert.Single(await fixture.Search.GetPublicPropertiesAsync(rooms: 1, adults: 2));

        Assert.Empty(policy.Calls);
        Assert.Equal("Unknown", result.AvailabilityStatusSummary);
        Assert.False(result.IsInstantBooking);
        Assert.Null(result.BookingDecisionReason);
        Assert.Equal(500_000m, result.StartingPrice);
        Assert.Equal(1, result.MatchingRoomTypesCount);
        var json = JsonSerializer.SerializeToElement(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.False(json.TryGetProperty("bookingDecisionReason", out _));
    }

    private static async Task ConfigureSearchPolicyAsync(Fixture fixture)
    {
        var property = await fixture.Db.Properties.SingleAsync();
        property.SameNightInstantBookingTime = new(23, 0);
        property.SameNightInstantBookingDayOffset = 0;
        property.SameNightFinalBookingTime = new(2, 0);
        property.SameNightFinalBookingDayOffset = 1;
        await fixture.Db.SaveChangesAsync();
    }

    private sealed class SearchClock(int day, int hour, int minute) : TimeProvider
    {
        private DateTimeOffset now = new(2035, 2, day, hour, minute, 0, TimeSpan.FromHours(3.5));
        public void Set(int day, int hour, int minute) => now = new(2035, 2, day, hour, minute, 0, TimeSpan.FromHours(3.5));
        public override DateTimeOffset GetUtcNow() => now.ToUniversalTime();
    }

    private sealed class ObservedSearchPolicy(TimeProvider clock) : IPropertySameNightBookingPolicyService
    {
        private readonly PropertySameNightBookingPolicyService inner = new(clock);
        public List<(int PropertyId, DateOnly CheckIn)> Calls { get; } = [];
        public SameNightBookingPolicyResult Evaluate(Property property, DateOnly requestedCheckIn)
        {
            Calls.Add((property.Id, requestedCheckIn));
            return inner.Evaluate(property, requestedCheckIn);
        }
    }
}
