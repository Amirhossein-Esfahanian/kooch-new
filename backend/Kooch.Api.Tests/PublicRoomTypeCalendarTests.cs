using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicRoomTypeCalendarTests
{
    private static readonly DateOnly FirstDay = new(2035, 2, 1);

    [Fact]
    public async Task PublicCalendar_UsesExplicitIranianPriceAndNullForMissingDays()
    {
        await using var db = await CreateContextAsync();
        db.RoomDailyPrices.AddRange(
            new RoomDailyPrice { RoomTypeId = 10, Date = FirstDay, GuestType = PricingGuestType.Iranian, BasePrice = 200 },
            new RoomDailyPrice { RoomTypeId = 10, Date = FirstDay.AddDays(1), GuestType = PricingGuestType.Foreign, BasePrice = 500 });
        await db.SaveChangesAsync();

        var result = await Service(db).GetAsync("public-property", 10, FirstDay, FirstDay.AddDays(1));

        Assert.NotNull(result);
        Assert.Equal(10, result.RoomTypeId);
        Assert.Equal(FirstDay, result.From);
        Assert.Equal(FirstDay.AddDays(1), result.To);
        Assert.Equal(200m, result.Days[0].StandardPrice);
        Assert.Null(result.Days[1].StandardPrice); // RoomType.BasePrice is deliberately not a calendar fallback.
        Assert.Equal(2, result.Days[0].AvailableUnits);
        Assert.Equal(AvailabilityStatus.Available, result.Days[0].AvailabilityStatus);
    }

    [Fact]
    public async Task PublicCalendar_UsesEffectiveRemainingAvailabilityAndCheckoutExclusiveDates()
    {
        await using var db = await CreateContextAsync();
        db.Reservations.Add(new Reservation
        {
            ReservationNumber = "R-111111", ClientId = 1, PropertyId = 1, RoomTypeId = 10,
            CheckInDate = FirstDay, CheckOutDate = FirstDay.AddDays(1),
            AdultCount = 1, Status = ReservationStatus.Confirmed
        });
        await db.SaveChangesAsync();

        var result = await Service(db).GetAsync("public-property", 10, FirstDay, FirstDay.AddDays(1));

        Assert.NotNull(result);
        Assert.Equal(1, result.Days[0].AvailableUnits);
        Assert.Equal(2, result.Days[1].AvailableUnits);
    }

    [Theory]
    [InlineData(AvailabilityStatus.OnRequest, 1, AvailabilityStatus.OnRequest)]
    [InlineData(AvailabilityStatus.Unavailable, 0, AvailabilityStatus.Unavailable)]
    public async Task PublicCalendar_PreservesEffectiveStatus(
        AvailabilityStatus configuredStatus, int configuredCount, AvailabilityStatus expectedStatus)
    {
        await using var db = await CreateContextAsync();
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = FirstDay, AvailableCount = configuredCount,
            Status = configuredStatus, IsClosed = configuredStatus == AvailabilityStatus.Unavailable
        });
        await db.SaveChangesAsync();

        var result = await Service(db).GetAsync("public-property", 10, FirstDay, FirstDay);

        Assert.NotNull(result);
        Assert.Equal(configuredCount, result.Days[0].AvailableUnits);
        Assert.Equal(expectedStatus, result.Days[0].AvailabilityStatus);
    }

    [Fact]
    public async Task PublicCalendar_DoesNotExposeAnotherPropertyOrInactiveOrUnpublishedRoom()
    {
        await using var db = await CreateContextAsync();
        db.Properties.Add(new Property { Id = 2, Name = "Other", Slug = "other", Status = PropertyStatus.Approved });
        db.RoomTypes.Add(new RoomType { Id = 20, PropertyId = 2, Name = "Other Room", Slug = "other-room", IsActive = true });
        await db.SaveChangesAsync();

        Assert.Null(await Service(db).GetAsync("public-property", 20, FirstDay, FirstDay));
        Assert.Null(await Service(db).GetAsync("missing", 10, FirstDay, FirstDay));
        (await db.RoomTypes.SingleAsync(room => room.Id == 10)).IsActive = false;
        await db.SaveChangesAsync();
        Assert.Null(await Service(db).GetAsync("public-property", 10, FirstDay, FirstDay));
        (await db.RoomTypes.SingleAsync(room => room.Id == 10)).IsActive = true;
        (await db.Properties.SingleAsync(property => property.Id == 1)).Status = PropertyStatus.PendingReview;
        await db.SaveChangesAsync();
        Assert.Null(await Service(db).GetAsync("public-property", 10, FirstDay, FirstDay));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(63)]
    public async Task PublicCalendar_RejectsInvalidOrExcessiveRanges(int dayOffset)
    {
        await using var db = await CreateContextAsync();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            Service(db).GetAsync("public-property", 10, FirstDay, FirstDay.AddDays(dayOffset)));
    }

    [Fact]
    public void PublicCalendar_RouteIsAnonymousAndDtoExcludesManagementAndQuoteFields()
    {
        var controller = typeof(PublicPropertiesController);
        Assert.NotNull(controller.GetCustomAttributes(typeof(AllowAnonymousAttribute), true).SingleOrDefault());
        var method = controller.GetMethod(nameof(PublicPropertiesController.GetRoomTypeCalendar))!;
        Assert.Equal("{slug}/room-types/{roomTypeId:int}/calendar",
            Assert.Single(method.GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>()).Template);
        Assert.Equal(["AvailabilityStatus", "AvailableUnits", "Date", "StandardPrice"],
            typeof(Kooch.Api.Dtos.Properties.PublicRoomTypeCalendarDayResponse)
                .GetProperties().Select(property => property.Name).OrderBy(name => name).ToArray());
    }

    [Fact]
    public async Task PublicCalendar_EndpointRejectsMissingAndReversedDatesAndHidesIneligibleRooms()
    {
        await using var db = await CreateContextAsync();
        var controller = new PublicPropertiesController(null!, null!, Service(db));

        Assert.IsType<BadRequestObjectResult>((await controller.GetRoomTypeCalendar(
            "public-property", 10, null, FirstDay, default)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.GetRoomTypeCalendar(
            "public-property", 10, FirstDay, null, default)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.GetRoomTypeCalendar(
            "public-property", 10, FirstDay, FirstDay.AddDays(-1), default)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.GetRoomTypeCalendar(
            "public-property", 10, FirstDay, FirstDay.AddDays(63), default)).Result);
        Assert.IsType<NotFoundResult>((await controller.GetRoomTypeCalendar(
            "other", 10, FirstDay, FirstDay, default)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetRoomTypeCalendar(
            "public-property", 10, FirstDay, FirstDay, default)).Result);
    }

    private static PublicRoomTypeCalendarService Service(KoochDbContext db) =>
        new(db, new EffectiveAvailabilityService(db));

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options;
        var db = new KoochDbContext(options);
        db.Properties.Add(new Property
        {
            Id = 1, Name = "Public", Slug = "public-property", Status = PropertyStatus.Approved
        });
        db.RoomTypes.Add(new RoomType
        {
            Id = 10, PropertyId = 1, Name = "Room", Slug = "room",
            IsActive = true, TotalInventory = 2, BasePrice = 999
        });
        await db.SaveChangesAsync();
        return db;
    }
}
