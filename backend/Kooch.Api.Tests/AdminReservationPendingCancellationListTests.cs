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
    public async Task PendingFilter_ExcludesRejectedResolvedAndMissingButIncludesRejectedThenPending()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var rejected = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var resolved = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var renewed = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, pending.Id, ReservationCancellationRequestStatus.Pending);
        await AddRequestAsync(harness, rejected.Id, ReservationCancellationRequestStatus.Rejected);
        await AddRequestAsync(harness, resolved.Id, ReservationCancellationRequestStatus.Resolved);
        await AddRequestAsync(harness, renewed.Id, ReservationCancellationRequestStatus.Rejected);
        await AddRequestAsync(harness, renewed.Id, ReservationCancellationRequestStatus.Pending);

        var unfiltered = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);
        var filtered = await harness.Service.SearchAsync(new ReservationListQuery
        {
            PendingCancellationRequest = true
        }, harness.SuperAdmin);

        Assert.Equal(5, unfiltered.TotalCount);
        Assert.Equal(2, filtered.TotalCount);
        Assert.Equal(1, filtered.TotalPages);
        Assert.Equal(2, filtered.Items.Count);
        Assert.Equal(new[] { pending.Id, renewed.Id }.Order(), filtered.Items.Select(item => item.Id).Order());
        Assert.All(filtered.Items, item => Assert.True(item.HasPendingCancellationRequest));
    }

    [Fact]
    public async Task PendingFilter_AppliesBeforePagingAndComposesWithStatusAndProperty()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var confirmed = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var pendingStatus = await harness.AddReservationAsync(ReservationStatus.Pending);
        var secondConfirmed = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await AddRequestAsync(harness, confirmed.Id, ReservationCancellationRequestStatus.Pending);
        await AddRequestAsync(harness, pendingStatus.Id, ReservationCancellationRequestStatus.Pending);
        await AddRequestAsync(harness, secondConfirmed.Id, ReservationCancellationRequestStatus.Pending);

        var first = await harness.Service.SearchAsync(new ReservationListQuery
        {
            PendingCancellationRequest = true, PropertyId = 10, Status = ReservationStatus.Confirmed,
            Page = 1, PageSize = 1, Sort = "reservationnumberasc"
        }, harness.SuperAdmin);
        var second = await harness.Service.SearchAsync(new ReservationListQuery
        {
            PendingCancellationRequest = true, PropertyId = 10, Status = ReservationStatus.Confirmed,
            Page = 2, PageSize = 1, Sort = "reservationnumberasc"
        }, harness.SuperAdmin);

        Assert.Equal(2, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Single(first.Items);
        Assert.Single(second.Items);
        Assert.Equal(new[] { confirmed.Id, secondConfirmed.Id }.Order(),
            first.Items.Concat(second.Items).Select(item => item.Id).Order());
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
