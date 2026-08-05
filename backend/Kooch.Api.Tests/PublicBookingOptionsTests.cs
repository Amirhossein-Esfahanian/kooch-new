using Kooch.Api.Data;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicBookingOptionsTests
{
    [Fact]
    public async Task Options_UseEffectiveRangeAvailabilityPricingAndNamedRooms()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        Assert.Equal(1, result.PropertyId);
        Assert.Equal(2, result.RoomTypes.Count);
        var instant = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 10);
        Assert.Equal(ReservationBookingModeFilter.Instant, instant.BookingMode);
        Assert.Equal(1, instant.AvailableCount);
        Assert.Equal(20, instant.FinalAmount);
        Assert.Equal(101, Assert.Single(instant.Rooms).RoomId);
        var onRequest = Assert.Single(result.RoomTypes, item => item.RoomTypeId == 20);
        Assert.Equal(ReservationBookingModeFilter.OnRequest, onRequest.BookingMode);
        Assert.Equal(40, onRequest.FinalAmount);
        Assert.Empty(result.UnavailableRoomTypes);
    }

    [Fact]
    public async Task Options_ExplainNamedRoomTypeWithoutAnActiveRoom()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        await SeedAsync(context);
        context.RoomTypes.Add(RoomType(30, InventoryMode.NamedRooms));
        await context.SaveChangesAsync();
        var service = new PublicBookingOptionsService(
            context,
            new EffectiveAvailabilityService(context),
            new RangePricingService());

        var result = await service.GetAsync(
            "public-property",
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3),
            1,
            0,
            []);

        Assert.DoesNotContain(result.RoomTypes, item => item.RoomTypeId == 30);
        var unavailable = Assert.Single(
            result.UnavailableRoomTypes,
            item => item.RoomTypeId == 30);
        Assert.Equal(PublicBookingUnavailableReason.NoActiveNamedRooms, unavailable.Reason);
    }

    [Fact]
    public void PublicController_ExposesBookingOptionsAtTheExpectedRoute()
    {
        var method = typeof(PublicPropertiesController).GetMethod(
            nameof(PublicPropertiesController.GetBookingOptions));
        Assert.NotNull(method);
        var route = Assert.Single(
            method.GetCustomAttributes(typeof(HttpGetAttribute), inherit: true)
                .Cast<HttpGetAttribute>());
        Assert.Equal("{slug}/booking-options", route.Template);
    }

    private static async Task SeedAsync(KoochDbContext context)
    {
        context.Users.Add(new User
        {
            Id = 1,
            FirstName = "Client",
            LastName = "One",
            PasswordHash = "hash",
            Role = UserRole.Client,
            IsActive = true
        });
        context.Guests.Add(new Guest
        {
            Id = 1,
            UserId = 1,
            FirstName = "Guest",
            LastName = "One"
        });
        context.Properties.Add(new Property
        {
            Id = 1,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Public Property",
            Slug = "public-property",
            Description = "Description",
            Address = "Address",
            City = "City",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        context.RoomTypes.AddRange(
            RoomType(10, InventoryMode.NamedRooms),
            RoomType(20, InventoryMode.TypeBasedInventory));
        context.Rooms.AddRange(
            new Room { Id = 100, RoomTypeId = 10, Name = "Room 100", IsActive = true },
            new Room { Id = 101, RoomTypeId = 10, Name = "Room 101", IsActive = true });
        context.Availabilities.Add(new Availability
        {
            RoomTypeId = 20,
            Date = new DateOnly(2035, 2, 1),
            AvailableCount = 2,
            Status = AvailabilityStatus.OnRequest
        });
        context.Reservations.Add(new Reservation
        {
            ReservationNumber = "KCH-HOLD",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            RoomTypeId = 10,
            RoomId = 100,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            AdultCount = 1,
            Currency = "IRR",
            Status = ReservationStatus.ApprovedAwaitingPayment
        });
        await context.SaveChangesAsync();
    }

    private static RoomType RoomType(int id, InventoryMode inventoryMode) =>
        new()
        {
            Id = id,
            PropertyId = 1,
            Name = "Room Type " + id,
            Slug = "room-type-" + id,
            Description = "Description",
            MaxAdults = 2,
            MaxChildren = 2,
            TotalInventory = 2,
            InventoryMode = inventoryMode,
            BasePrice = 100,
            IsActive = true
        };

    private sealed class RangePricingService : IReservationPricingService
    {
        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            var nights = request.CheckOutDate.DayNumber - request.CheckInDate.DayNumber;
            return Task.FromResult(new ReservationPricePreviewResponse
            {
                PropertyId = request.PropertyId,
                RoomTypeId = request.RoomTypeId,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                Adults = request.Adults,
                Children = request.Children,
                NightsCount = nights,
                FinalAmount = nights * request.RoomTypeId,
                Currency = "IRR"
            });
        }
    }
}
