using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AvailabilityServiceMultiInventoryTests
{
    private static readonly DateOnly StartDate = new(2026, 8, 10);

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(4)]
    [InlineData(7)]
    [InlineData(10)]
    public async Task BulkUpdateStoresAnyCapacityWithinTotalInventory(int availableCapacity)
    {
        await using var dbContext = CreateContext();
        AddPropertyAndRoomType(dbContext, totalInventory: 10, roomTypeName: "دابل دلوکس");
        await dbContext.SaveChangesAsync();
        var service = CreateService(dbContext);

        var result = await service.BulkUpdateInventoryAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new BulkInventoryRequest
            {
                RoomTypeId = 20,
                StartDate = StartDate,
                EndDate = StartDate.AddDays(2),
                AvailableCount = availableCapacity
            });

        var stored = await dbContext.Availabilities
            .Where(item => item.RoomTypeId == 20)
            .OrderBy(item => item.Date)
            .ToListAsync();
        Assert.Equal(3, stored.Count);
        Assert.All(stored, item => Assert.Equal(availableCapacity, item.AvailableCount));
        Assert.Equal("دابل دلوکس", Assert.Single(result.RoomTypes).Name);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(11)]
    public async Task BulkUpdateRejectsCapacityOutsideRoomTypeInventory(int availableCapacity)
    {
        await using var dbContext = CreateContext();
        AddPropertyAndRoomType(dbContext, totalInventory: 10);
        await dbContext.SaveChangesAsync();
        var service = CreateService(dbContext);

        await Assert.ThrowsAsync<ArgumentException>(() => service.BulkUpdateInventoryAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new BulkInventoryRequest
            {
                RoomTypeId = 20,
                StartDate = StartDate,
                EndDate = StartDate.AddDays(1),
                AvailableCount = availableCapacity
            }));

        Assert.Empty(dbContext.Availabilities);
    }

    [Fact]
    public async Task BulkCellUpdateValidatesEverySelectedRoomType()
    {
        await using var dbContext = CreateContext();
        AddPropertyAndRoomType(dbContext, totalInventory: 10);
        dbContext.RoomTypes.Add(CreateRoomType(21, 10, "سوئیت", totalInventory: 3));
        await dbContext.SaveChangesAsync();
        var service = CreateService(dbContext);

        await Assert.ThrowsAsync<ArgumentException>(() => service.BulkUpdateInventoryCellsAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new BulkInventoryCellsRequest
            {
                AvailableCount = 4,
                Items =
                [
                    new BulkInventoryCellItem { RoomTypeId = 20, Date = StartDate },
                    new BulkInventoryCellItem { RoomTypeId = 21, Date = StartDate.AddDays(1) }
                ]
            }));

        Assert.Empty(dbContext.Availabilities);
    }

    [Fact]
    public async Task InventoryProjectionSubtractsHoldsFromConfiguredDailyCapacity()
    {
        await using var dbContext = CreateContext();
        AddPropertyAndRoomType(dbContext, totalInventory: 10, roomTypeName: "زنبق");
        dbContext.Availabilities.Add(new Availability
        {
            RoomTypeId = 20,
            Date = StartDate,
            AvailableCount = 7,
            Status = AvailabilityStatus.Available
        });
        dbContext.Reservations.AddRange(
            CreateReservation(100, ReservationStatus.ApprovedAwaitingPayment),
            CreateReservation(101, ReservationStatus.Confirmed),
            CreateReservation(102, ReservationStatus.PendingApproval),
            CreateReservation(103, ReservationStatus.Cancelled));
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).GetPropertyInventoryAsync(
            1,
            UserRole.SuperAdmin,
            10,
            StartDate,
            StartDate);

        var roomType = Assert.Single(result.RoomTypes);
        Assert.Equal("زنبق", roomType.Name);
        Assert.Equal(5, Assert.Single(roomType.Days).AvailableCount);
        Assert.Equal(10, roomType.TotalInventory);
        Assert.Equal(7, (await dbContext.Availabilities.SingleAsync()).AvailableCount);
    }

    private static AvailabilityService CreateService(KoochDbContext dbContext) =>
        new(
            dbContext,
            new AllowAllPropertyAccessService(),
            new NoOpAuditLogService(),
            new EffectiveAvailabilityService(dbContext));

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static void AddPropertyAndRoomType(
        KoochDbContext dbContext,
        int totalInventory,
        string roomTypeName = "دابل")
    {
        dbContext.Properties.Add(new Property
        {
            Id = 10,
            Name = "اقامتگاه تست",
            Slug = "test-property",
            Description = "Test",
            Address = "Test",
            City = "کاشان",
            Country = "IR"
        });
        dbContext.RoomTypes.Add(CreateRoomType(20, 10, roomTypeName, totalInventory));
    }

    private static RoomType CreateRoomType(int id, int propertyId, string name, int totalInventory) =>
        new()
        {
            Id = id,
            PropertyId = propertyId,
            Name = name,
            Slug = $"room-type-{id}",
            Description = "Test",
            TotalInventory = totalInventory,
            IsActive = true
        };

    private static Reservation CreateReservation(int id, ReservationStatus status) =>
        new()
        {
            Id = id,
            ReservationNumber = $"KCH-TEST-{id}",
            ClientId = 1,
            PropertyId = 10,
            RoomTypeId = 20,
            CheckInDate = StartDate,
            CheckOutDate = StartDate.AddDays(1),
            AdultCount = 1,
            FinalAmount = 100,
            TotalPrice = 100,
            Status = status
        };
}

internal sealed class AllowAllPropertyAccessService : IPropertyAccessService
{
    public Task<bool> CanViewAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);

    public Task<bool> CanManagePropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);

    public Task<bool> CanManageRoomsAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);

    public Task<bool> CanManageAvailabilityAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);

    public Task<bool> CanManagePricingAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);
}
