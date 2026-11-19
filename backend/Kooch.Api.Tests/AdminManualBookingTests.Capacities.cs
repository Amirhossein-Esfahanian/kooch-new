using System.Text.Json;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingTests
{
    [Theory]
    [InlineData(2, true, 3, 3)]
    [InlineData(2, true, 0, 0)]
    [InlineData(2, false, 5, 0)]
    [InlineData(0, true, 1, 1)]
    public async Task Availability_ExposesExistingEffectiveCapacitiesSeparatelyFromInventory(
        int baseCapacity, bool extraAllowed, int configuredExtra, int expectedExtra)
    {
        await using var h = await Setup();
        var type = (await h.DbContext.RoomTypes.FindAsync(20))!;
        type.InventoryMode = InventoryMode.TypeBasedInventory;
        type.MaxAdults = baseCapacity;
        type.AllowExtraGuest = extraAllowed;
        type.MaxExtraGuests = configuredExtra;
        await h.DbContext.SaveChangesAsync();
        var children = new ChildPricingRuleResolver(h.DbContext);
        var resolver = new ReservationRulesResolver(h.DbContext, children);
        var pricing = new ReservationPricingService(h.DbContext, new PricingService(), children, resolver);
        var response = await new ManualBookingAvailabilityService(h.DbContext, h.EffectiveAvailability, pricing)
            .GetAsync(10, h.CheckIn, h.CheckOut, PricingGuestType.Iranian);
        var option = Assert.Single(response.Options);
        var rules = await resolver.ResolveAsync(10, 20);
        Assert.Equal(baseCapacity, option.BaseCapacity);
        Assert.Equal(expectedExtra, option.MaxExtraGuests);
        Assert.Equal(rules.BaseCapacity, option.BaseCapacity);
        Assert.Equal(rules.MaxExtraGuests, option.MaxExtraGuests);
        Assert.Equal(3, option.AvailableCount);
        Assert.Empty(option.Rooms);
    }

    [Fact]
    public void Availability_CapacityContractPreservesMissingVersusExplicitZero()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var missing = JsonSerializer.SerializeToElement(new ManualBookingRoomTypeOption(), options);
        var zero = JsonSerializer.SerializeToElement(new ManualBookingRoomTypeOption
            { BaseCapacity = 0, MaxExtraGuests = 0 }, options);
        Assert.Equal(JsonValueKind.Null, missing.GetProperty("baseCapacity").ValueKind);
        Assert.Equal(JsonValueKind.Null, missing.GetProperty("maxExtraGuests").ValueKind);
        Assert.Equal(0, zero.GetProperty("baseCapacity").GetInt32());
        Assert.Equal(0, zero.GetProperty("maxExtraGuests").GetInt32());
    }
}
