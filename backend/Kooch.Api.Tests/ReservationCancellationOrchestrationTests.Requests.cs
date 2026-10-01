using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationCancellationOrchestrationTests
{
    [Fact]
    public async Task AdminDetail_ExposesLatestPendingRequestWithoutInternalIdentifiers()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        var result = await AdminController(db).GetById(1, default);
        var detail = Assert.IsType<ReservationResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ReservationCancellationRequestStatus.Pending, detail.CancellationRequest!.Status);
        Assert.Equal(ReservationCancellationReason.GuestRequest, detail.CancellationRequest.Reason);
        Assert.Equal("Please cancel", detail.CancellationRequest.GuestMessage);
        Assert.DoesNotContain(typeof(AdminReservationCancellationRequestResponse).GetProperties(), property =>
            property.Name is "Id" or "RequestedByUserId" or "ResolvedByUserId" or "FinanceId");
    }

    [Fact]
    public async Task AdminDetail_WithoutRequestReturnsNull()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var result = await AdminController(db).GetById(1, default);
        var detail = Assert.IsType<ReservationResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(detail.CancellationRequest);
    }

    [Fact]
    public async Task AdminDetail_RequiresViewPermissionBeforeRequestProjection()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            AdminController(db, cancelAllowed: false).GetById(1, default));
    }

    [Fact]
    public async Task Reject_RecordsActorTimestampNoteAndLeavesReservationAndFinanceUnchanged()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        var result = await AdminController(db).RejectCancellationRequest(1, new() { Note = "  Not approved  " }, default);
        var projection = Assert.IsType<AdminReservationCancellationRequestResponse>(
            Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ReservationCancellationRequestStatus.Rejected, projection.Status);
        Assert.Equal("Not approved", projection.ResolutionNote);
        var saved = await db.ReservationCancellationRequests.SingleAsync();
        Assert.Equal(1, saved.ResolvedByUserId);
        Assert.NotNull(saved.ResolvedAtUtc);
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Null((await db.Reservations.SingleAsync()).CancellationIdempotencyKey);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Empty(await db.FinancialEntries.ToListAsync());
    }

    [Fact]
    public async Task Reject_PaidRequestDoesNotChangeExistingFinancialRecords()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddRequestAsync(db);
        var originalPayable = await db.FinancialEntries.SingleAsync();
        var originalAmount = originalPayable.Amount;
        await RequestService(db).RejectAsync(1, 1, UserRole.SuperAdmin, null);
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Equal(originalAmount, (await db.FinancialEntries.SingleAsync()).Amount);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
    }

    [Theory]
    [InlineData(ReservationCancellationRequestStatus.Rejected)]
    [InlineData(ReservationCancellationRequestStatus.Resolved)]
    public async Task Reject_NonPendingRequestConflictsWithoutRewritingHistory(ReservationCancellationRequestStatus status)
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var row = await AddRequestAsync(db);
        row.Status = status;
        row.ResolvedAtUtc = DateTime.UtcNow;
        row.ResolvedByUserId = 1;
        await db.SaveChangesAsync();
        var originalTime = row.ResolvedAtUtc;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            RequestService(db).RejectAsync(1, 1, UserRole.SuperAdmin, "again"));
        await db.Entry(row).ReloadAsync();
        Assert.Equal(status, row.Status);
        Assert.Equal(originalTime, row.ResolvedAtUtc);
    }

    [Fact]
    public async Task Reject_WithoutRequestIsNotFound()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            RequestService(db).RejectAsync(1, 1, UserRole.SuperAdmin, null));
    }

    [Theory]
    [InlineData(false, UserRole.SuperAdmin)]
    [InlineData(true, UserRole.Client)]
    public async Task Reject_RequiresReservationCancellationAuthority(bool cancelAllowed, UserRole role)
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            RequestService(db, cancelAllowed).RejectAsync(1, 1, role, null));
        Assert.Equal(ReservationCancellationRequestStatus.Pending,
            (await db.ReservationCancellationRequests.SingleAsync()).Status);
    }

    [Fact]
    public async Task Reject_RequiresManageReservationsEvenWhenPropertyPermissionExists()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        var service = new ReservationCancellationRequestService(db, new DeniedManageReservations());
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RejectAsync(1, 1, UserRole.AdminAssistant, null));
        Assert.Equal(ReservationCancellationRequestStatus.Pending,
            (await db.ReservationCancellationRequests.SingleAsync()).Status);
    }

    [Fact]
    public async Task PaidCancellation_ResolvesPendingRequestInExistingTransaction()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddRequestAsync(db);
        await Service(db).CancelAsync(1, Auto(), Actor);
        var row = await db.ReservationCancellationRequests.SingleAsync();
        Assert.Equal(ReservationCancellationRequestStatus.Resolved, row.Status);
        Assert.Equal(1, row.ResolvedByUserId);
        Assert.NotNull(row.ResolvedAtUtc);
        Assert.Equal(ReservationStatus.Cancelled, (await db.Reservations.SingleAsync()).Status);
        Assert.Single(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task FailedFinalSave_RollsBackRequestResolutionAndReservationAndFinance()
    {
        await using var store = await Store.CreateAsync();
        await using (var seed = store.Open()) await AddRequestAsync(seed);
        await using (var failing = store.Open(failOnRequestResolution: true))
            await Assert.ThrowsAsync<InvalidOperationException>(() => Service(failing).CancelAsync(1, Auto(), Actor));
        await using var verify = store.Open();
        Assert.Equal(ReservationCancellationRequestStatus.Pending,
            (await verify.ReservationCancellationRequests.SingleAsync()).Status);
        Assert.Equal(ReservationStatus.Confirmed, (await verify.Reservations.SingleAsync()).Status);
        Assert.Empty(await verify.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task CancellationWithoutRequestStillWorks()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        Assert.Equal(ReservationStatus.Cancelled, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.ReservationCancellationRequests.ToListAsync());
    }

    [Fact]
    public async Task OldRejectedRequestIsPreservedWhileCurrentPendingResolves()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        db.ReservationCancellationRequests.Add(new ReservationCancellationRequestRecord
        {
            ReservationId = 1, RequestedByUserId = 2, Status = ReservationCancellationRequestStatus.Rejected,
            Reason = ReservationCancellationReason.GuestRequest, RequestedAtUtc = DateTime.UtcNow.AddDays(-1),
            ResolvedAtUtc = DateTime.UtcNow.AddDays(-1), ResolvedByUserId = 1
        });
        await db.SaveChangesAsync();
        await AddRequestAsync(db);
        await Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        var history = await db.ReservationCancellationRequests.OrderBy(row => row.RequestedAtUtc).ToListAsync();
        Assert.Equal(ReservationCancellationRequestStatus.Rejected, history[0].Status);
        Assert.Equal(ReservationCancellationRequestStatus.Resolved, history[1].Status);
    }

    [Fact]
    public async Task ExactCancellationReplayDoesNotRewriteResolvedRequest()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        var service = Service(db, paymentsAllowed: false);
        await service.CancelAsync(1, Auto(), Actor);
        var first = await db.ReservationCancellationRequests.SingleAsync();
        var resolvedAt = first.ResolvedAtUtc;
        await service.CancelAsync(1, Auto(), Actor);
        await db.Entry(first).ReloadAsync();
        Assert.Equal(resolvedAt, first.ResolvedAtUtc);
        Assert.Equal(ReservationCancellationRequestStatus.Resolved, first.Status);
    }

    [Fact]
    public async Task CancellationCommittedBeforeReject_PreventsLateRejection()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await AddRequestAsync(db);
        await Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            RequestService(db).RejectAsync(1, 1, UserRole.SuperAdmin, "too late"));
        var row = await db.ReservationCancellationRequests.SingleAsync();
        Assert.Equal(ReservationCancellationRequestStatus.Resolved, row.Status);
    }

    [Theory]
    [InlineData(ReservationCancellationRequestStatus.Pending)]
    [InlineData(ReservationCancellationRequestStatus.Rejected)]
    [InlineData(ReservationCancellationRequestStatus.Resolved)]
    public async Task PersistenceGuard_RejectsInvalidStatusTransitions(ReservationCancellationRequestStatus destination)
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var row = await AddRequestAsync(db);
        row.Status = ReservationCancellationRequestStatus.Rejected;
        row.ResolvedAtUtc = DateTime.UtcNow;
        row.ResolvedByUserId = 1;
        await db.SaveChangesAsync();
        row.Status = destination;
        row.ResolutionNote = "rewritten";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public void AdminRejectRoute_UsesExistingManageReservationsPermission()
    {
        var method = typeof(AdminReservationsController).GetMethod(nameof(AdminReservationsController.RejectCancellationRequest))!;
        var permission = Assert.Single(method.GetCustomAttributes<PermissionAuthorizeAttribute>());
        Assert.Contains(nameof(PermissionKey.ManageReservations), permission.Policy);
        Assert.Equal("{id:int}/cancellation-request/reject",
            Assert.Single(method.GetCustomAttributes<Microsoft.AspNetCore.Mvc.HttpPutAttribute>()).Template);
    }

    private static async Task<ReservationCancellationRequestRecord> AddRequestAsync(KoochDbContext db)
    {
        var row = new ReservationCancellationRequestRecord
        {
            ReservationId = 1, RequestedByUserId = 2, Status = ReservationCancellationRequestStatus.Pending,
            Reason = ReservationCancellationReason.GuestRequest, GuestMessage = "Please cancel",
            RequestedAtUtc = DateTime.UtcNow
        };
        db.ReservationCancellationRequests.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    private static ReservationCancellationRequestService RequestService(KoochDbContext db, bool cancelAllowed = true) =>
        new(db, new Permissions(cancelAllowed, payments: true));

    private static AdminReservationsController AdminController(KoochDbContext db, bool cancelAllowed = true)
    {
        var permissions = new Permissions(cancelAllowed, payments: true);
        var controller = new AdminReservationsController(
            Service(db), null!, null!, null!, permissions,
            new ReservationCancellationRequestService(db, permissions))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "1"),
             new Claim(ClaimTypes.Role, UserRole.SuperAdmin.ToString())], "test"));
        return controller;
    }

    private sealed class DeniedManageReservations : IPermissionService
    {
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}
