using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCreationPropertyApprovalTests
{
    [Theory]
    [InlineData(PropertyStatus.Approved)]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task AdminManualCreation_RequiresApprovedProperty(PropertyStatus status)
    {
        await using var harness = await ReservationTestHarness.CreateAsync(useAuthoritativePricing: true);
        (await harness.DbContext.Properties.SingleAsync()).Status = status;
        await harness.DbContext.SaveChangesAsync();
        var request = new ReservationCreateRequest
        {
            PropertyId = 10, RoomTypeId = 20, RoomId = 30, GuestId = 40,
            CheckInDate = harness.CheckIn, CheckOutDate = harness.CheckOut, Adults = 1
        };
        if (status == PropertyStatus.Approved)
        {
            var created = await harness.Service.CreateAsync(request, harness.SuperAdmin);
            Assert.Equal(ReservationStatus.Pending, created.Status);
            Assert.Single(await harness.DbContext.Reservations.ToListAsync());
        }
        else
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => harness.Service.CreateAsync(request, harness.SuperAdmin));
            // Existing pricing validation already rejects Rejected/Suspended before persistence.
            Assert.Equal(status is PropertyStatus.Rejected or PropertyStatus.Suspended
                ? "Property is not available for reservations."
                : "Only Approved Properties can accept new bookings.", error.Message);
            Assert.Empty(await harness.DbContext.Reservations.ToListAsync());
            Assert.Empty(await harness.DbContext.BookingSessions.ToListAsync());
            Assert.Empty(await harness.DbContext.AuditLogs.ToListAsync());
            Assert.Empty(await harness.DbContext.Payments.ToListAsync());
        }
    }
}
