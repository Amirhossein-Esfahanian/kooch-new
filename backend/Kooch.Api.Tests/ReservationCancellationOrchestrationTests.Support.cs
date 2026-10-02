using System.Reflection;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationCancellationOrchestrationTests
{
    private static CreateReservationCancellationRequest SupportRequest() => new()
    {
        Reason = ReservationCancellationReason.GuestRequest,
        Message = "  Guest called support  "
    };

    [Fact]
    public async Task Support_Create_RecordsGuestOwnershipActorSourceAndDoesNotCancelOrFinancialize()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var result = await AdminController(db).CreateCancellationRequest(1, SupportRequest(), default);
        var response = Assert.IsType<AdminReservationCancellationRequestResponse>(
            Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ReservationCancellationRequestStatus.Pending, response.Status);
        Assert.Equal(ReservationCancellationRequestSource.Support, response.RequestSource);
        Assert.Equal("Guest called support", response.GuestMessage);
        var saved = await db.ReservationCancellationRequests.SingleAsync();
        Assert.Equal(1, saved.ReservationId);
        Assert.Equal(2, saved.RequestedByUserId);
        Assert.Equal(1, saved.CreatedByUserId);
        Assert.Equal(ReservationCancellationRequestSource.Support, saved.RequestSource);
        var reservation = await db.Reservations.SingleAsync();
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Null(reservation.CancellationIdempotencyKey);
        Assert.Null(reservation.CancellationRequestFingerprint);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Equal(88, (await db.FinancialEntries.SingleAsync()).Amount);
        Assert.Equal(100, (await db.Payments.SingleAsync()).Amount);
    }

    [Fact]
    public async Task Support_Create_UsesExistingNarrowAuthorization()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            RequestService(db, cancelAllowed: false).CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest()));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            new ReservationCancellationRequestService(db, new DeniedManageReservations())
                .CreateForSupportAsync(1, 1, UserRole.AdminAssistant, SupportRequest()));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            RequestService(db).CreateForSupportAsync(1, 2, UserRole.Client, SupportRequest()));
        Assert.Empty(await db.ReservationCancellationRequests.ToListAsync());
    }

    [Fact]
    public async Task Support_Create_RejectsInvalidReservationGuestAndReason()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var service = RequestService(db);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.CreateForSupportAsync(999, 1, UserRole.SuperAdmin, SupportRequest()));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, new() { Reason = (ReservationCancellationReason)999 }));
        var reservation = await db.Reservations.SingleAsync();
        reservation.Status = ReservationStatus.Cancelled;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest()));
        reservation.Status = ReservationStatus.Confirmed;
        await db.SaveChangesAsync();
        var guest = await db.Guests.SingleAsync();
        guest.UserId = null;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest()));
        Assert.Empty(await db.ReservationCancellationRequests.ToListAsync());
    }

    [Fact]
    public async Task SupportAndGuest_RejectEachOthersPendingRequest()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var service = RequestService(db);
        await service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(2, "R-100001", SupportRequest()));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest()));
        Assert.Single(await db.ReservationCancellationRequests.ToListAsync());
    }

    [Fact]
    public async Task GuestPending_RejectsSupportAndRemainsGuestOnline()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var service = RequestService(db);
        await service.CreateAsync(2, "R-100001", SupportRequest());
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest()));
        var row = await db.ReservationCancellationRequests.SingleAsync();
        Assert.Equal(ReservationCancellationRequestSource.GuestOnline, row.RequestSource);
        Assert.Equal(2, row.CreatedByUserId);
    }

    [Fact]
    public async Task ConcurrentSupportAttempts_CannotPersistTwoPendingRequests()
    {
        await using var store = await Store.CreateAsync(paid: false);
        async Task AttemptAsync()
        {
            await using var db = store.Open();
            await RequestService(db).CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        }
        var results = await Task.WhenAll(Task.Run(async () => await Record.ExceptionAsync(AttemptAsync)),
            Task.Run(async () => await Record.ExceptionAsync(AttemptAsync)));
        Assert.Single(results, error => error is null);
        await using var verify = store.Open();
        Assert.Single(await verify.ReservationCancellationRequests
            .Where(row => row.Status == ReservationCancellationRequestStatus.Pending).ToListAsync());
    }

    [Fact]
    public async Task SupportRequest_IsVisibleThroughExistingGuestReadProjection()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var service = RequestService(db);
        await service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        var guest = await service.GetLatestAsync(2, "R-100001");
        Assert.Equal(ReservationCancellationRequestStatus.Pending, guest.Status);
        Assert.Equal("Guest called support", guest.Message);
        var admin = await service.GetLatestForAdminAsync(1);
        Assert.Equal(ReservationCancellationRequestSource.Support, admin!.RequestSource);
    }

    [Fact]
    public async Task RejectedHistory_RemainsWhenSupportCreatesNewPending()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        var service = RequestService(db);
        await service.RejectAsync(1, 1, UserRole.SuperAdmin, null);
        await service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        var rows = await db.ReservationCancellationRequests.OrderBy(row => row.Id).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(ReservationCancellationRequestStatus.Rejected, rows[0].Status);
        Assert.Equal(ReservationCancellationRequestStatus.Pending, rows[1].Status);
        Assert.Equal(ReservationCancellationRequestSource.Support, rows[1].RequestSource);
    }

    [Fact]
    public async Task SupportPending_ReusesRejectAndResolutionFlows()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var service = RequestService(db);
        await service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        await service.RejectAsync(1, 1, UserRole.SuperAdmin, null);
        Assert.Equal(ReservationCancellationRequestStatus.Rejected,
            (await db.ReservationCancellationRequests.SingleAsync()).Status);
        await service.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        await Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        var rows = await db.ReservationCancellationRequests.OrderBy(row => row.Id).ToListAsync();
        Assert.Equal(ReservationCancellationRequestStatus.Resolved, rows[1].Status);
    }

    [Fact]
    public void SupportRoute_UsesManageReservationsAndDoesNotExposeOwnershipFields()
    {
        var method = typeof(AdminReservationsController).GetMethod(nameof(AdminReservationsController.CreateCancellationRequest))!;
        var permission = Assert.Single(method.GetCustomAttributes<PermissionAuthorizeAttribute>());
        Assert.Contains(nameof(PermissionKey.ManageReservations), permission.Policy);
        Assert.Equal("{id:int}/cancellation-request",
            Assert.Single(method.GetCustomAttributes<HttpPostAttribute>()).Template);
        Assert.DoesNotContain(typeof(AdminReservationCancellationRequestResponse).GetProperties(), property =>
            property.Name is "Id" or "RequestedByUserId" or "CreatedByUserId" or "ResolvedByUserId");
        Assert.DoesNotContain(typeof(CreateReservationCancellationRequest).GetProperties(), property =>
            property.Name is "GuestUserId" or "RequestedByUserId" or "RequestSource" or "Status");
    }
}
