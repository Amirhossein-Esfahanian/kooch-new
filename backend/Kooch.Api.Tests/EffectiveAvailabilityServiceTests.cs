using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class EffectiveAvailabilityServiceTests
{
    [Theory]
    [InlineData(ReservationStatus.PendingApproval, 0)]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment, 1)]
    [InlineData(ReservationStatus.Confirmed, 1)]
    [InlineData(ReservationStatus.Paid, 1)]
    [InlineData(ReservationStatus.Cancelled, 0)]
    [InlineData(ReservationStatus.Rejected, 0)]
    [InlineData(ReservationStatus.PaymentExpired, 0)]
    [InlineData(ReservationStatus.CapacityLost, 0)]
    public async Task OnlyCapacityHoldingStatusesConsumeInventory(
        ReservationStatus status,
        int expectedClaimedCapacity)
    {
        await using var dbContext = CreateContext();
        var checkIn = new DateOnly(2026, 8, 1);
        var checkOut = checkIn.AddDays(2);
        dbContext.RoomTypes.Add(new RoomType
        {
            Id = 20,
            PropertyId = 10,
            Name = "Double room",
            Slug = "double-room",
            Description = "Test",
            TotalInventory = 2,
            IsActive = true
        });
        dbContext.Reservations.Add(new Reservation
        {
            Id = 100,
            ReservationNumber = "KCH-TEST-100",
            ClientId = 1,
            PropertyId = 10,
            RoomTypeId = 20,
            CheckInDate = checkIn,
            CheckOutDate = checkOut,
            AdultCount = 1,
            FinalAmount = 100,
            TotalPrice = 100,
            Status = status
        });
        await dbContext.SaveChangesAsync();

        var availability = await new EffectiveAvailabilityService(dbContext)
            .GetRangeAsync([20], checkIn, checkOut);

        Assert.All(
            availability[20].Nights.Values,
            night =>
            {
                Assert.Equal(expectedClaimedCapacity, night.ClaimedCapacity);
                Assert.Equal(2 - expectedClaimedCapacity, night.RemainingCapacity);
            });
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }
}
