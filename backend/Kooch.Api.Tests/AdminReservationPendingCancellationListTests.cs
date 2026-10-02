using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminReservationPendingCancellationListTests
{
    [Theory]
    [InlineData(ReservationCancellationRequestStatus.Pending, true)]
    [InlineData(ReservationCancellationRequestStatus.Rejected, false)]
    [InlineData(ReservationCancellationRequestStatus.Resolved, false)]
    public async Task AdminList_ReportsOnlyPendingRequest(
        ReservationCancellationRequestStatus status, bool expected)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, reservation.Id, status);

        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);

        Assert.Equal(expected, Assert.Single(result.Items).HasPendingCancellationRequest);
        Assert.Equal(ReservationStatus.Confirmed, result.Items[0].Status);
    }

    [Fact]
    public async Task AdminList_NoRequest_ReturnsFalse()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        await harness.AddReservationAsync(ReservationStatus.Confirmed);

        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);

        Assert.False(Assert.Single(result.Items).HasPendingCancellationRequest);
    }

    [Fact]
    public async Task AdminList_OldRejectedAndNewPending_ReturnsTrue()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, reservation.Id, ReservationCancellationRequestStatus.Rejected);
        await AddRequestAsync(harness, reservation.Id, ReservationCancellationRequestStatus.Pending);

        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);

        Assert.True(Assert.Single(result.Items).HasPendingCancellationRequest);
    }

    [Fact]
    public async Task AdminList_PagingAndPropertyFilterRemainUnchanged()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var first = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var second = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, second.Id, ReservationCancellationRequestStatus.Pending);

        var firstPage = await harness.Service.SearchAsync(new ReservationListQuery
        {
            PropertyId = 10, Page = 1, PageSize = 1, Sort = "reservationnumberasc"
        }, harness.SuperAdmin);
        var secondPage = await harness.Service.SearchAsync(new ReservationListQuery
        {
            PropertyId = 10, Page = 2, PageSize = 1, Sort = "reservationnumberasc"
        }, harness.SuperAdmin);

        Assert.Equal(2, firstPage.TotalCount);
        Assert.Equal(2, firstPage.TotalPages);
        Assert.Single(firstPage.Items);
        Assert.Single(secondPage.Items);
        Assert.Equal(new[] { first.ReservationNumber, second.ReservationNumber }.Order(),
            firstPage.Items.Concat(secondPage.Items).Select(item => item.ReservationNumber));
        Assert.Single(firstPage.Items.Concat(secondPage.Items), item => item.HasPendingCancellationRequest);
    }

    [Fact]
    public async Task NonAdminListPaths_DoNotExposeTheAdminPendingFlag()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, reservation.Id, ReservationCancellationRequestStatus.Pending);

        var owner = await harness.Service.SearchByPropertyAsync(10, new ReservationListQuery());
        var guest = await harness.Service.SearchByGuestUserAsync(3, new ReservationListQuery());

        Assert.False(Assert.Single(owner.Items).HasPendingCancellationRequest);
        Assert.False(Assert.Single(guest.Items).HasPendingCancellationRequest);
    }

    private static async Task AddRequestAsync(ReservationTestHarness harness, int reservationId,
        ReservationCancellationRequestStatus status)
    {
        harness.DbContext.ReservationCancellationRequests.Add(new ReservationCancellationRequestRecord
        {
            ReservationId = reservationId,
            RequestedByUserId = 3,
            Status = status,
            Reason = ReservationCancellationReason.GuestRequest,
            RequestedAtUtc = DateTime.UtcNow.AddMinutes(-1),
            ResolvedAtUtc = status == ReservationCancellationRequestStatus.Pending ? null : DateTime.UtcNow,
            ResolvedByUserId = status == ReservationCancellationRequestStatus.Pending ? null : 1
        });
        await harness.DbContext.SaveChangesAsync();
    }
}
