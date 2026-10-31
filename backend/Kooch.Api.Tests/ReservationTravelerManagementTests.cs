using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationTravelerManagementTests
{
    [Theory]
    [InlineData(ReservationStatus.Pending, null)]
    [InlineData(ReservationStatus.Confirmed, null)]
    [InlineData(ReservationStatus.Paid, null)]
    [InlineData(ReservationStatus.Pending, 40)]
    [InlineData(ReservationStatus.Paid, 40)]
    public async Task FullUpdate_PreservesSnapshotAndAssociationWithoutSelectingGuest(
        ReservationStatus status, int? guestId)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(status);
        Capture(reservation, guestId);
        await harness.DbContext.SaveChangesAsync();
        var before = Snapshot(reservation);
        var request = Update(reservation);
        var json = JsonSerializer.Serialize(request).TrimEnd('}') +
            ",\"TravelerFirstNameSnapshot\":\"Attacker\",\"TravelerSnapshotKind\":null}";
        request = JsonSerializer.Deserialize<ReservationUpdateRequest>(json)!;
        Assert.True(Validator.TryValidateObject(request, new ValidationContext(request), [], true));
        var result = await FullEditService(harness).UpdateAsync(reservation.Id, request, harness.SuperAdmin);
        harness.DbContext.ChangeTracker.Clear();
        var saved = await harness.DbContext.Reservations.SingleAsync();
        Assert.Equal(before, Snapshot(saved));
        Assert.Equal(guestId, saved.GuestId);
        Assert.Equal("Management note", saved.GuestNote);
        Assert.Equal("Booked Traveler", result.GuestFullName);
        Assert.Null(result.GuestMobile);
        Assert.Single(await harness.DbContext.Guests.ToListAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(40)]
    public async Task Snapshot_ReassignmentIsRejected(int? guestId)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Pending);
        Capture(reservation, guestId);
        await harness.DbContext.SaveChangesAsync();
        var before = Snapshot(reservation);
        var request = Update(reservation);
        request.GuestId = 99;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            harness.Service.UpdateAsync(reservation.Id, request, harness.SuperAdmin));
        Assert.Equal(before, Snapshot(await harness.DbContext.Reservations.SingleAsync()));
        Assert.Equal(guestId, reservation.GuestId);
    }

    [Fact]
    public async Task ApprovalCancellationAndGuestEdits_DoNotRefreshSnapshot()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.PendingApproval);
        Capture(reservation, null);
        await harness.DbContext.SaveChangesAsync();
        var before = Snapshot(reservation);
        var guest = await harness.DbContext.Guests.SingleAsync();
        guest.FirstName = "Changed canonical";
        await harness.DbContext.SaveChangesAsync();
        await harness.Service.ApproveAsync(reservation.Id, harness.Owner);
        Assert.Equal(before, Snapshot(await harness.DbContext.Reservations.SingleAsync()));
        await harness.Service.CancelAsync(reservation.Id, new ReservationCancellationRequest
        {
            Reason = ReservationCancellationReason.GuestRequest, Explanation = "Requested cancellation"
        }, harness.SuperAdmin);
        Assert.Equal(before, Snapshot(await harness.DbContext.Reservations.SingleAsync()));
        Assert.Null(reservation.GuestId);
    }

    [Fact]
    public async Task UnauthorizedManagementAndCrossAccountRead_AreDenied()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(permissionGranted: false);
        var reservation = await harness.AddReservationAsync(ReservationStatus.Pending);
        Capture(reservation, null);
        await harness.DbContext.SaveChangesAsync();
        var before = Snapshot(reservation);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.UpdateAsync(reservation.Id, Update(reservation), (2, UserRole.AdminAssistant)));
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetByIdForGuestUserAsync(2, reservation.Id));
        Assert.Equal(before, Snapshot(reservation));
    }

    [Fact]
    public async Task LegacyUpdate_StillRequiresAndSupportsCanonicalGuest()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Pending);
        var request = Update(reservation);
        await Assert.ThrowsAsync<ArgumentException>(() =>
            FullEditService(harness).UpdateAsync(reservation.Id, request, harness.SuperAdmin));
        request.GuestId = 40;
        await FullEditService(harness).UpdateAsync(reservation.Id, request, harness.SuperAdmin);
        Assert.Equal(40, reservation.GuestId);
        Assert.Null(reservation.TravelerSnapshotKind);
    }

    [Fact]
    public void UpdateDto_HasNoWritableTravelerSnapshotFields()
    {
        foreach (var property in typeof(Reservation).GetProperties()
                     .Where(property => property.Name.StartsWith("Traveler", StringComparison.Ordinal)))
            Assert.Null(typeof(ReservationUpdateRequest).GetProperty(property.Name));
    }

    private static ReservationUpdateRequest Update(Reservation reservation) => new()
    {
        RoomTypeId = reservation.RoomTypeId, RoomIds = reservation.RoomId is int id ? [id] : [],
        CheckInDate = reservation.CheckInDate, CheckOutDate = reservation.CheckOutDate,
        Adults = reservation.AdultCount, Children = reservation.ChildCount, Notes = "Management note"
    };

    private static ReservationService FullEditService(ReservationTestHarness harness) => new(
        harness.DbContext, new ReservationAvailabilityService(harness.DbContext, harness.EffectiveAvailability),
        new StubReservationPricingService(), new StubReservationNumberGenerator(),
        new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
        harness.AuditLogService, new StubPermissionService(true), new StubPropertyAuthorizationService(true),
        new ReservationStatusWorkflow(), harness.EffectiveAvailability, new TestHostEnvironment());

    private static void Capture(Reservation reservation, int? guestId)
    {
        reservation.GuestId = guestId;
        reservation.TravelerSnapshotKind = guestId.HasValue ? (byte)1 : (byte)2;
        reservation.TravelerFirstNameSnapshot = "Booked";
        reservation.TravelerLastNameSnapshot = "Traveler";
        reservation.TravelerMobileSnapshot = null;
        reservation.TravelerEmailSnapshot = "booked@example.test";
        reservation.TravelerNationalCodeSnapshot = "1234567891";
        reservation.TravelerSnapshotCapturedAtUtc = new DateTime(2026, 10, 27, 12, 0, 0, DateTimeKind.Utc);
    }

    private static string Snapshot(Reservation reservation) => JsonSerializer.Serialize(new
    {
        reservation.TravelerSnapshotKind, reservation.TravelerFirstNameSnapshot,
        reservation.TravelerLastNameSnapshot, reservation.TravelerMobileSnapshot,
        reservation.TravelerEmailSnapshot, reservation.TravelerNationalCodeSnapshot,
        reservation.TravelerSnapshotCapturedAtUtc
    });
}
