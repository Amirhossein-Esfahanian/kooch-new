using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RoomServiceTests
{
    [Fact]
    public async Task CreateRoom_CreatesActiveRoomForRequestedRoomTypeAndProperty()
    {
        await using var context = await CreateContextAsync();
        var service = new RoomService(context, new PropertyAccessService(context));

        var result = await service.CreateRoomAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new CreateRoomRequest { Name = "  زنبق ۱  " });

        Assert.True(result.IsActive);
        Assert.Equal("زنبق ۱", result.Name);
        Assert.Equal(10, result.RoomTypeId);

        var stored = await context.Rooms
            .Include(room => room.RoomType)
            .SingleAsync();
        Assert.True(stored.IsActive);
        Assert.Equal(10, stored.RoomTypeId);
        Assert.Equal(100, stored.RoomType.PropertyId);
    }

    [Fact]
    public async Task CreateRoom_RejectsActorWithoutPropertyRoomPermission()
    {
        await using var context = await CreateContextAsync();
        var service = new RoomService(context, new PropertyAccessService(context));

        var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.CreateRoomAsync(
                2,
                UserRole.Client,
                10,
                new CreateRoomRequest { Name = "محراب ۱" }));

        Assert.Equal("You cannot manage rooms for this property.", exception.Message);
        Assert.Empty(await context.Rooms.ToListAsync());
    }

    [Fact]
    public async Task CreateRoom_RejectsDuplicateNameWithinRoomType()
    {
        await using var context = await CreateContextAsync();
        var service = new RoomService(context, new PropertyAccessService(context));

        await service.CreateRoomAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new CreateRoomRequest { Name = "زنبق ۱" });

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateRoomAsync(
                1,
                UserRole.SuperAdmin,
                10,
                new CreateRoomRequest { Name = "زنبق ۱" }));

        Assert.Equal("A room with this name already exists for the room type.", exception.Message);
        Assert.Single(await context.Rooms.ToListAsync());
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"room-service-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);

        context.Users.AddRange(
            new User
            {
                Id = 1,
                FirstName = "مدیر",
                LastName = "سیستم",
                PasswordHash = "hash",
                Role = UserRole.SuperAdmin,
                IsActive = true
            },
            new User
            {
                Id = 2,
                FirstName = "کاربر",
                LastName = "مهمان",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            });
        context.Destinations.Add(new Destination
        {
            Id = 50,
            Name = "کاشان",
            Slug = "kashan",
            Country = "IR"
        });
        context.Properties.Add(new Property
        {
            Id = 100,
            OwnerId = 1,
            DestinationId = 50,
            Name = "سرای آزمون",
            Slug = "test-property",
            Description = "توضیحات",
            Address = "نشانی",
            City = "کاشان",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        context.RoomTypes.Add(new RoomType
        {
            Id = 10,
            PropertyId = 100,
            Name = "زنبق",
            Slug = "zanbagh",
            Description = "نوع اتاق نام‌دار",
            MaxAdults = 2,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
            IsActive = true
        });
        await context.SaveChangesAsync();
        return context;
    }
}
