using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminReservationOrderSummaryTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public async Task DirectDetails_UsesTheSameScopedOrderSummaryAsTheList(int count)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var rooms = new List<Reservation>();
        for (var i = 0; i < count; i++) rooms.Add(await harness.AddReservationAsync(ReservationStatus.Confirmed));
        await LinkAsync(harness, rooms.ToArray());
        var details = await harness.Service.GetByIdAsync(rooms[0].Id);
        await harness.Service.ApplyAdminOrderSummaryAsync(details, harness.SuperAdmin);
        Assert.Equal("B-ISOLATED-ORDER", details.BookingSessionCode);
        Assert.Equal(count, details.LinkedReservationCount);
        var list = await harness.Service.SearchAsync(new ReservationListQuery { PageSize = 1 }, harness.SuperAdmin);
        Assert.Equal(list.Items[0].LinkedReservationCount, details.LinkedReservationCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DirectDetails_DoesNotExposeAnInaccessibleOrderOrMembers(bool denyAll)
    {
        await using var harness = await ReservationTestHarness.CreateAsync(permissionGranted: !denyAll);
        var visible = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var hidden = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        hidden.PropertyId = 11;
        await LinkAsync(harness, visible, hidden);
        var details = await harness.Service.GetByIdAsync(visible.Id);
        await harness.Service.ApplyAdminOrderSummaryAsync(details, harness.SuperAdmin);
        Assert.Null(details.BookingSessionCode);
        Assert.Null(details.LinkedReservationCount);
    }

    [Fact]
    public async Task MembershipCount_IsIndependentOfListFiltersAndPagination()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var first = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var second = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var cancelled = await harness.AddReservationAsync(ReservationStatus.Cancelled);
        await LinkAsync(harness, first, second, cancelled);
        var page1 = await harness.Service.SearchAsync(new ReservationListQuery
            { Status = ReservationStatus.Confirmed, Page = 1, PageSize = 1, Sort = "reservationnumberasc" }, harness.SuperAdmin);
        var page2 = await harness.Service.SearchAsync(new ReservationListQuery
            { Status = ReservationStatus.Confirmed, Page = 2, PageSize = 1, Sort = "reservationnumberasc" }, harness.SuperAdmin);
        Assert.Equal(2, page1.TotalCount);
        Assert.NotEqual(Assert.Single(page1.Items).Id, Assert.Single(page2.Items).Id);
        foreach (var item in page1.Items.Concat(page2.Items))
        {
            Assert.Equal("B-ISOLATED-ORDER", item.BookingSessionCode);
            Assert.Equal(3, item.LinkedReservationCount);
        }
    }

    [Fact]
    public async Task OrderWithAnOutOfScopeRoom_DoesNotExposeItsCodeOrCount()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var visible = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var hidden = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        hidden.PropertyId = 11;
        await LinkAsync(harness, visible, hidden);
        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);
        var row = Assert.Single(result.Items);
        Assert.Equal(visible.Id, row.Id);
        Assert.Equal(1, result.TotalCount);
        Assert.Null(row.BookingSessionCode);
        Assert.Null(row.LinkedReservationCount);
    }

    [Fact]
    public async Task StandaloneAndSingleRoomOrders_AreNotInventedOrCombined()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var standalone = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var single = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        await LinkAsync(harness, single);
        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);
        Assert.Null(result.Items.Single(row => row.Id == standalone.Id).LinkedReservationCount);
        Assert.Equal(1, result.Items.Single(row => row.Id == single.Id).LinkedReservationCount);
        var owner = await harness.Service.SearchByPropertyAsync(10, new ReservationListQuery());
        Assert.All(owner.Items, row => { Assert.Null(row.BookingSessionCode); Assert.Null(row.LinkedReservationCount); });
    }

    [Fact]
    public async Task OutOfScopeOrderParent_DoesNotExposeSummaryEvenIfItsRoomIsVisible()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        await LinkAsync(harness, await harness.AddReservationAsync(ReservationStatus.Confirmed));
        harness.DbContext.BookingSessions.Single().PropertyId = 11;
        await harness.DbContext.SaveChangesAsync();
        var row = Assert.Single((await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin)).Items);
        Assert.Null(row.BookingSessionCode);
        Assert.Null(row.LinkedReservationCount);
    }

    [Fact]
    public async Task MissingPropertyAccess_StillReturnsNoRowsOrOrderMetadata()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(permissionGranted: false);
        await LinkAsync(harness, await harness.AddReservationAsync(ReservationStatus.Confirmed));
        var result = await harness.Service.SearchAsync(new ReservationListQuery(), harness.SuperAdmin);
        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalCount);
    }

    private static async Task LinkAsync(ReservationTestHarness harness, params Reservation[] reservations)
    {
        var session = new BookingSession { SessionCode = "B-ISOLATED-ORDER", PropertyId = 10, ClientId = 1, Currency = "IRR" };
        harness.DbContext.BookingSessions.Add(session);
        foreach (var reservation in reservations) reservation.BookingSession = session;
        await harness.DbContext.SaveChangesAsync();
    }
}
