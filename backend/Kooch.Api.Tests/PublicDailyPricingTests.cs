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
