using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CurrencyLabel_CannotBeOverwrittenOnAnExistingBooking(bool reservationTitle)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var create = harness.CreateService())
            await create.Service.CreateAsync(CreateRequest(CreateItem(10, 100)));
        await using var read = harness.CreateContext();
        if (reservationTitle) (await read.Reservations.SingleAsync()).CurrencyLabel = "تغییر تاریخچه";
        else (await read.BookingSessions.SingleAsync()).CurrencyLabel = "تغییر تاریخچه";
        await Assert.ThrowsAsync<InvalidOperationException>(() => read.SaveChangesAsync());
    }

    [Fact]
    public async Task CurrencyLabel_IsCapturedOnce_AndReplayAndReadsKeepOriginalTitle()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.SiteSettings.Add(new SiteSetting { Key = "pricing.currencyLabel", Value = "تومان", IsActive = true });
            await setup.SaveChangesAsync();
        }
        var request = CreateRequest(CreateItem(10, 100));
        request.IdempotencyKey = "currency-snapshot";
        BookingSessionCreateResult created;
        await using (var scope = harness.CreateService()) created = await scope.Service.CreateAsync(request);
        Assert.Equal("تومان", created.CurrencyLabel);
        Assert.Equal("تومان", Assert.Single(created.Reservations).CurrencyLabel);
        Assert.Equal("IRR", created.Currency);
        Assert.Equal(100, Assert.Single(created.Reservations).FinalAmount);

        await using (var settings = harness.CreateContext())
        {
            (await settings.SiteSettings.SingleAsync(x => x.Key == "pricing.currencyLabel")).Value = "عنوان جدید";
            await settings.SaveChangesAsync();
        }
        await using (var replay = harness.CreateService())
            Assert.Equal("تومان", (await replay.Service.CreateAsync(request)).CurrencyLabel);

        await using var read = harness.CreateContext();
        var queries = new BookingSessionQueryService(read);
        var guest = await queries.GetBySessionCodeForClientAsync(1, created.SessionCode);
        var admin = await queries.GetByIdAsync(created.BookingSessionId);
        Assert.Equal("تومان", guest.CurrencyLabel);
        Assert.Equal("تومان", admin.CurrencyLabel);
        Assert.Equal("تومان", Assert.Single(guest.Reservations).CurrencyLabel);
        Assert.Equal("تومان", Assert.Single(admin.Reservations).CurrencyLabel);

        await using var next = harness.CreateService();
        var nextBooking = await next.Service.CreateAsync(CreateRequest(CreateItem(20, 200)));
        Assert.Equal("عنوان جدید", nextBooking.CurrencyLabel);
        Assert.Equal("عنوان جدید", Assert.Single(nextBooking.Reservations).CurrencyLabel);
        Assert.Equal("IRR", nextBooking.Currency);
        Assert.Equal(100, Assert.Single(nextBooking.Reservations).FinalAmount);
    }
}
