using System.Text.Json;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationTravelerReadSecurityTests
{
    [Fact]
    public async Task LegacyWithoutGuest_BookerRetainsListAndDetailAccess()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        reservation.GuestId = null;
        await harness.DbContext.SaveChangesAsync();
        var detail = await harness.Service.GetByNumberForGuestUserAsync(1, reservation.ReservationNumber!);
        Assert.Empty(detail.GuestFullName);
        Assert.Null(detail.GuestEmail);
        Assert.Single((await harness.Service.SearchByGuestUserAsync(1, new ReservationListQuery())).Items);
        Assert.Empty((await harness.Service.SearchByGuestUserAsync(2, new ReservationListQuery())).Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetByIdForGuestUserAsync(2, reservation.Id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Booker_LegacyForeignOrUnlinkedGuestIsRedacted(bool unlinked)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var guest = await harness.DbContext.Guests.SingleAsync();
        guest.UserId = unlinked ? null : 3;
        guest.FirstName = "PrivateFirst";
        guest.LastName = "PrivateLast";
        guest.Mobile = "09999999999";
        guest.Email = "private@example.test";
        guest.NationalCode = "9999999999";
        guest.PassportNumber = "PRIVATEPASSPORT";
        guest.Nationality = "PRIVATECOUNTRY";
        await harness.DbContext.SaveChangesAsync();
        var detail = await harness.Service.GetByIdForGuestUserAsync(1, reservation.Id);
        var byNumber = await harness.Service.GetByNumberForGuestUserAsync(1, reservation.ReservationNumber!);
        var list = await harness.Service.SearchByGuestUserAsync(1, new ReservationListQuery());
        Assert.Null(detail.GuestId);
        Assert.Empty(detail.GuestFullName);
        Assert.Single(list.Items);
        Assert.Empty(list.Items[0].GuestFullName);
        var json = JsonSerializer.Serialize(new { detail, byNumber, list });
        foreach (var secret in new[] { guest.FirstName, guest.LastName, guest.Mobile, guest.Email,
                     guest.NationalCode, guest.PassportNumber, guest.Nationality })
            Assert.DoesNotContain(secret!, json);
        var filtered = await harness.Service.SearchByGuestUserAsync(1,
            new ReservationListQuery { GuestSearch = "PrivateFirst" });
        Assert.Empty(filtered.Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetByIdForGuestUserAsync(2, reservation.Id));
        if (!unlinked)
            Assert.Equal(guest.FullName,
                (await harness.Service.GetByIdForGuestUserAsync(3, reservation.Id)).GuestFullName);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Snapshot_IsAuthoritativeIncludingNullFieldsAndNullGuest(bool nullGuest)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        reservation.TravelerSnapshotKind = 2;
        reservation.TravelerFirstNameSnapshot = "Booked";
        reservation.TravelerLastNameSnapshot = "Traveler";
        reservation.TravelerSnapshotCapturedAtUtc = DateTime.UtcNow;
        if (nullGuest) reservation.GuestId = null;
        var guest = await harness.DbContext.Guests.SingleAsync();
        guest.Mobile = "09999999999";
        guest.Email = "foreign@example.test";
        guest.NationalCode = "9999999999";
        guest.PassportNumber = "FOREIGN";
        await harness.DbContext.SaveChangesAsync();
        var detail = await harness.Service.GetByIdForGuestUserAsync(1, reservation.Id);
        var admin = await harness.Service.GetByIdAsync(reservation.Id);
        foreach (var response in new[] { detail, admin })
        {
            Assert.Equal("Booked Traveler", response.GuestFullName);
            Assert.Null(response.GuestId);
            Assert.Null(response.GuestMobile);
            Assert.Null(response.GuestEmail);
            Assert.Null(response.GuestNationalCode);
            Assert.Null(response.GuestPassportNumber);
            Assert.Null(response.GuestNationality);
            Assert.Equal(100, response.FinalAmount);
        }
        var list = await harness.Service.SearchByGuestUserAsync(1, new ReservationListQuery());
        Assert.Equal("Booked Traveler", Assert.Single(list.Items).GuestFullName);
        Assert.Null(list.Items[0].GuestMobile);
        var filtered = await harness.Service.SearchByGuestUserAsync(1,
            new ReservationListQuery { GuestSearch = "Booked" });
        Assert.Single(filtered.Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetByNumberForGuestUserAsync(2, reservation.ReservationNumber!));
    }
}
