using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicPropertyPricingTests
{
    [Fact]
    public async Task PublicProperty_UsesDailyPricingInsteadOfLegacyAvailabilityPrice()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        context.Properties.Add(new Property
        {
            Id = 1,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Daily Price Property",
            Slug = "daily-price-property",
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
            Name = "Room Type",
            Slug = "room-type",
            Description = "Description",
            MaxAdults = 2,
            TotalInventory = 1,
            InventoryMode = InventoryMode.TypeBasedInventory,
            BasePrice = null,
            IsActive = true
        });
        context.Availabilities.Add(new Availability
        {
            RoomTypeId = 10,
            Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),
            AvailableCount = 1,
            Status = AvailabilityStatus.Available,
            Price = 0
        });
        context.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = 10,
            Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),
            GuestType = PricingGuestType.Iranian,
            BasePrice = 2_500_000
        });
        await context.SaveChangesAsync();

        var access = new PropertyAccessService(context);
        var service = new PropertyService(
            context,
            access,
            access,
            new PermissionService(context, access),
            null!,
            null!);

        var result = await service.GetPublicPropertyBySlugAsync("daily-price-property");

        Assert.NotNull(result);
        Assert.Equal(2_500_000, result.StartingPrice);
        var roomType = Assert.Single(result.RoomTypes);
        Assert.Equal(2_500_000, roomType.AvailabilityPrice);
        Assert.Equal(2_500_000, roomType.DisplayPrice);
    }
}
