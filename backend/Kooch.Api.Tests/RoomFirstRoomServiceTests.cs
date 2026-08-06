using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RoomFirstRoomServiceTests
{
    [Fact]
    public async Task CreatePropertyRoom_CreatesInternalTemplateAndPhysicalRoomAtomically()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();

        var result = await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("Zanbagh", RoomKind.Double));

        Assert.Equal("Zanbagh", result.Name);
        Assert.Equal(RoomKind.Double, result.RoomKind);
        Assert.Equal("double", result.RoomKindCode);
        var roomType = await fixture.Context.RoomTypes.SingleAsync();
        Assert.Equal("Double-1", roomType.Name);
        Assert.Equal("double-1", roomType.Slug);
        Assert.DoesNotContain("Zanbagh", roomType.Name);
        Assert.Equal(0, roomType.TotalInventory);
        Assert.False(roomType.IsActive);
        Assert.Equal(roomType.Id, (await fixture.Context.Rooms.SingleAsync()).RoomTypeId);
    }

    [Fact]
    public async Task CreatePropertyRoom_ReusesExactTemplateForMultipleHotelRooms()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();

        var first = await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("101", RoomKind.Twin));
        var second = await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("102", RoomKind.Twin));

        Assert.Equal(first.RoomTypeId, second.RoomTypeId);
        Assert.Single(await fixture.Context.RoomTypes.ToListAsync());
        Assert.Equal(2, await fixture.Context.Rooms.CountAsync());
        Assert.Equal(0, (await fixture.Context.RoomTypes.SingleAsync()).TotalInventory);
    }

    [Fact]
    public async Task LegacyRoomFirstPath_DoesNotChangeExistingSellableInventoryOrStatus()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();
        fixture.Context.RoomTypes.Add(new RoomType
        {
            PropertyId = 10,
            Name = "Sellable Double",
            Slug = "sellable-double",
            Description = "Sellable Double",
            RoomKind = RoomKind.Double,
            MaxAdults = 2,
            MaxChildren = 1,
            TotalInventory = 3,
            InventoryMode = InventoryMode.TypeBasedInventory,
            BasePrice = 2_500_000,
            IsActive = true
        });
        await fixture.Context.SaveChangesAsync();

        await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("101", RoomKind.Double));

        var roomType = await fixture.Context.RoomTypes.SingleAsync();
        Assert.Equal(3, roomType.TotalInventory);
        Assert.True(roomType.IsActive);
        Assert.Single(await fixture.Context.Rooms.ToListAsync());
    }

    [Fact]
    public async Task CreatePropertyRoom_CreatesAnotherTemplateWhenSpecificationDiffers()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();
        await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("Zanbagh", RoomKind.Double));
        var differentCapacity = Request("Mehrab", RoomKind.Double);
        differentCapacity.MaxAdults = 3;

        await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, differentCapacity);

        Assert.Equal(2, await fixture.Context.RoomTypes.CountAsync());
        Assert.Equal(2, await fixture.Context.Rooms.CountAsync());
    }

    [Fact]
    public async Task CreatePropertyRoom_RejectsDuplicateRoomNameAcrossTemplates()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();
        await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("Zanbagh", RoomKind.Double));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Service.CreatePropertyRoomAsync(
                1, UserRole.SuperAdmin, 10, Request("Zanbagh", RoomKind.Suite)));

        Assert.Equal("A room with this name already exists for the property.", exception.Message);
        Assert.Single(await fixture.Context.RoomTypes.ToListAsync());
        Assert.Single(await fixture.Context.Rooms.ToListAsync());
    }

    [Fact]
    public async Task CreatePropertyRoom_RollsBackTemplateAndRoomWhenSavePipelineFails()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();
        fixture.Interceptor.ThrowAfterSave = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Service.CreatePropertyRoomAsync(
                1, UserRole.SuperAdmin, 10, Request("Zanbagh", RoomKind.Double)));

        fixture.Interceptor.ThrowAfterSave = false;
        fixture.Context.ChangeTracker.Clear();
        Assert.Empty(await fixture.Context.RoomTypes.ToListAsync());
        Assert.Empty(await fixture.Context.Rooms.ToListAsync());
    }

    [Fact]
    public async Task GetRoomsByProperty_ReturnsPhysicalRoomsWithoutInternalTemplateName()
    {
        await using var fixture = await RoomFirstFixture.CreateAsync();
        await fixture.Service.CreatePropertyRoomAsync(
            1, UserRole.SuperAdmin, 10, Request("Mehrab", RoomKind.Twin));

        var rooms = await fixture.Service.GetRoomsByPropertyAsync(
            1, UserRole.SuperAdmin, 10);

        var room = Assert.Single(rooms);
        Assert.Equal("Mehrab", room.Name);
        Assert.Equal(RoomKind.Twin, room.RoomKind);
        Assert.Null(typeof(OwnerRoomResponse).GetProperty("RoomTypeName"));
    }

    private static CreatePropertyRoomRequest Request(string name, RoomKind roomKind) =>
        new()
        {
            Name = name,
            RoomKind = roomKind,
            MaxAdults = 2,
            MaxChildren = 1,
            InventoryMode = InventoryMode.NamedRooms,
            BasePrice = 2_500_000
        };

    private sealed class RoomFirstFixture : IAsyncDisposable
    {
        private RoomFirstFixture(
            SqliteConnection connection,
            KoochDbContext context,
            ThrowAfterSaveInterceptor interceptor)
        {
            Connection = connection;
            Context = context;
            Interceptor = interceptor;
            Service = new RoomService(context, new PropertyAccessService(context));
        }

        public SqliteConnection Connection { get; }
        public KoochDbContext Context { get; }
        public ThrowAfterSaveInterceptor Interceptor { get; }
        public RoomService Service { get; }

        public static async Task<RoomFirstFixture> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var interceptor = new ThrowAfterSaveInterceptor();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .AddInterceptors(interceptor)
                .Options;
            var context = new KoochDbContext(options);
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(new User
            {
                Id = 1,
                FirstName = "Admin",
                LastName = "User",
                PasswordHash = "hash",
                Role = UserRole.SuperAdmin,
                IsActive = true
            });
            context.Destinations.Add(new Destination
            {
                Id = 20,
                Name = "Kashan",
                Slug = "kashan",
                Country = "IR"
            });
            context.Properties.Add(new Property
            {
                Id = 10,
                OwnerId = 1,
                DestinationId = 20,
                Name = "Test Property",
                Slug = "test-property",
                Description = "Description",
                Address = "Address",
                City = "Kashan",
                Country = "IR",
                Status = PropertyStatus.Approved
            });
            await context.SaveChangesAsync();
            return new RoomFirstFixture(connection, context, interceptor);
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await Connection.DisposeAsync();
        }
    }

    private sealed class ThrowAfterSaveInterceptor : SaveChangesInterceptor
    {
        public bool ThrowAfterSave { get; set; }

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData,
            int result,
            CancellationToken cancellationToken = default)
        {
            if (ThrowAfterSave)
            {
                throw new InvalidOperationException("Simulated save pipeline failure.");
            }

            return ValueTask.FromResult(result);
        }
    }
}
