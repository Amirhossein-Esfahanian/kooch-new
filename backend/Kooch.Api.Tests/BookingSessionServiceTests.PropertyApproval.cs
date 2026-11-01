using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Theory]
    [InlineData(PropertyStatus.Approved)]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task AllNewSessionPaths_RequireApprovedProperty(PropertyStatus status)
    {
        foreach (var account in new[] { false, true })
        foreach (var onRequest in new[] { false, true })
        {
            await using var harness = await BookingSessionTestHarness.CreateAsync();
            await using (var setup = harness.CreateContext())
            {
                (await setup.Properties.SingleAsync(property => property.Id == 1)).Status = status;
                if (onRequest) setup.Availabilities.Add(new Availability
                {
                    RoomTypeId = 10, Date = new(2035, 2, 1), AvailableCount = 2, Status = AvailabilityStatus.OnRequest
                });
                await setup.SaveChangesAsync();
            }
            await using var scope = harness.CreateService();
            var create = () => account
                ? scope.Service.CreateForAccountAsync(1, CreateAccountRequest(CreateAccountItem(10, 100)))
                : scope.Service.CreateAsync(CreateRequest(CreateItem(10, 100)));
            if (status == PropertyStatus.Approved)
            {
                var result = await create();
                Assert.Single(result.Reservations);
                if (onRequest) Assert.Equal(ReservationStatus.PendingApproval, result.Reservations[0].Status);
            }
            else
            {
                var error = await Assert.ThrowsAsync<InvalidOperationException>(create);
                Assert.Equal("Only Approved Properties can accept new bookings.", error.Message);
                await using var verify = harness.CreateContext();
                Assert.Empty(await verify.BookingSessions.ToListAsync());
                Assert.Empty(await verify.Reservations.ToListAsync());
                Assert.Empty(await verify.ReservationActivities.ToListAsync());
                Assert.Empty(await verify.Payments.ToListAsync());
                Assert.Empty(scope.NotificationDispatcher.PendingApprovalReservationIds);
                Assert.Equal(2, (await verify.RoomTypes.FindAsync(10))!.TotalInventory);
            }
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExistingSessionReplay_DoesNotRevalidatePropertyApproval(bool account)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var internalRequest = CreateRequest(CreateItem(10, 100));
        internalRequest.IdempotencyKey = "approval-replay";
        var accountRequest = CreateAccountRequest(CreateAccountItem(10, 100));
        int originalId;
        await using (var first = harness.CreateService())
            originalId = (account ? await first.Service.CreateForAccountAsync(1, accountRequest)
                : await first.Service.CreateAsync(internalRequest)).BookingSessionId;
        await using (var change = harness.CreateContext())
        {
            (await change.Properties.SingleAsync(property => property.Id == 1)).Status = PropertyStatus.Draft;
            await change.SaveChangesAsync();
        }
        await using var replay = harness.CreateService();
        var result = account ? await replay.Service.CreateForAccountAsync(1, accountRequest)
            : await replay.Service.CreateAsync(internalRequest);
        Assert.Equal(originalId, result.BookingSessionId);
        await using var verify = harness.CreateContext();
        Assert.Single(await verify.BookingSessions.ToListAsync());
        Assert.Single(await verify.Reservations.ToListAsync());
    }
}
