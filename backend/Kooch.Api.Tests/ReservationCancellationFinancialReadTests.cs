using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Payments;
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
    public async Task UnpaidDetailHasNoFabricatedCancellationFinancialFacts()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var state = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.False(state.PaidCancellation);
        Assert.Null(state.GrossPaidAmount);
        Assert.Null(state.Currency);
        Assert.Null(state.Mode);
        Assert.Null(state.GuestRefundAmount);
        Assert.False(state.RefundPending);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PaidDetailUsesSuccessfulAllocationNotReservationFinalAmount(bool session)
    {
        await using var store = await Store.CreateAsync(finalAmount: 999, session: session);
        await using var db = store.Open();
        var state = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.True(state.PaidCancellation);
        Assert.Equal(100m, state.GrossPaidAmount);
        Assert.Equal("IRR", state.Currency);
        Assert.NotEqual((await db.Reservations.SingleAsync()).FinalAmount, state.GrossPaidAmount);
        Assert.Null(state.Mode);
        Assert.Null(state.GuestRefundAmount);
        Assert.Null(state.FinalPropertyShare);
        Assert.Null(state.FinalKoochShare);
        Assert.False(state.RefundPending);
        Assert.False(state.AlreadyHandledByLegacyRefundV1);
    }

    [Fact]
    public async Task AutomaticResolutionPendingThenRecordedRefundUsesPersistedOutcome()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Auto(), Actor);
        var pending = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.Equal(CancellationFinancialResolutionMode.AutomaticFullRefundV1, pending.Mode);
        Assert.Equal(100m, pending.GrossPaidAmount);
        Assert.Equal(100m, pending.GuestRefundAmount);
        Assert.Equal(0m, pending.FinalPropertyShare);
        Assert.Equal(0m, pending.FinalKoochShare);
        Assert.True(pending.RefundPending);

        await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1, Refund(), Actor.UserId);
        var recorded = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.False(recorded.RefundPending);
        Assert.Equal(pending.GrossPaidAmount, recorded.GrossPaidAmount);
        Assert.Equal(pending.GuestRefundAmount, recorded.GuestRefundAmount);
    }

    [Theory]
    [InlineData(50, 40, 10, true)]
    [InlineData(0, 40, 60, false)]
    public async Task ManualResolutionProjectsExactPersistedSplitAndZeroRefundIsNotPending(
        decimal guest, decimal property, decimal kooch, bool pending)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Manual(guest: guest, property: property, kooch: kooch), Actor);
        var state = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.Equal(CancellationFinancialResolutionMode.ManualOverride, state.Mode);
        Assert.Equal(100m, state.GrossPaidAmount);
        Assert.Equal(guest, state.GuestRefundAmount);
        Assert.Equal(property, state.FinalPropertyShare);
        Assert.Equal(kooch, state.FinalKoochShare);
        Assert.Equal(pending, state.RefundPending);
    }

    [Fact]
    public async Task LegacyRefundIsRecognizedWithoutSyntheticResolutionValues()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1,
            new ReservationRefundRequest
            {
                ReferenceNumber = "legacy-bank", RefundedAt = Now,
                Reason = "legacy full refund", IdempotencyKey = "legacy-refund"
            }, Actor.UserId);
        await Service(db).CancelAsync(1, Auto(), Actor);
        var state = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.True(state.PaidCancellation);
        Assert.True(state.AlreadyHandledByLegacyRefundV1);
        Assert.False(state.RefundPending);
        Assert.Equal(100m, state.GrossPaidAmount);
        Assert.Null(state.Mode);
        Assert.Null(state.GuestRefundAmount);
        Assert.Null(state.FinalPropertyShare);
        Assert.Null(state.FinalKoochShare);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task CapacityLostPaymentDoesNotFabricateNormalCancellationResolution()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        (await db.Reservations.SingleAsync()).Status = ReservationStatus.CapacityLost;
        await db.SaveChangesAsync();
        var state = await Service(db).GetCancellationFinancialStateAsync(1);
        Assert.True(state.PaidCancellation);
        Assert.Equal(100m, state.GrossPaidAmount);
        Assert.Null(state.Mode);
        Assert.Null(state.GuestRefundAmount);
        Assert.False(state.RefundPending);
    }

    [Fact]
    public async Task ConflictingResolutionAndLegacyRefundHistoryFailsExplicitly()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Auto(), Actor);
        db.RefundRecords.Add(new RefundRecord
        {
            PaymentId = 1, ReservationId = 1, PropertyId = 1, Amount = 100, Currency = "IRR",
            RefundedAtUtc = Now.UtcDateTime, ReferenceNumber = "legacy-bank", Reason = "legacy",
            RecordedByUserId = Actor.UserId, RecordedAtUtc = Now.UtcDateTime,
            IdempotencyKey = "legacy-refund", RequestFingerprint = new string('a', 64)
        });
        await db.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service(db).GetCancellationFinancialStateAsync(1));
        Assert.Contains("inconsistent", error.Message);
    }

    [Fact]
    public async Task AdminDetailRequiresBookingsVisibilityAndManagePaymentsForFinancialProjection()
    {
        await using var store = await Store.CreateAsync(finalAmount: 999);
        await using var db = store.Open();
        var allowed = await AdminDetail(db, bookingsAllowed: true, paymentsAllowed: true).GetById(1, default);
        var visible = Assert.IsType<ReservationResponse>(Assert.IsType<OkObjectResult>(allowed.Result).Value);
        Assert.NotNull(visible.CancellationFinancial);
        Assert.Equal("R-100001", visible.ReservationNumber);
        Assert.Equal(999m, visible.PaidAmount); // Existing detail field is unchanged.

        var restricted = await AdminDetail(db, bookingsAllowed: true, paymentsAllowed: false).GetById(1, default);
        var hidden = Assert.IsType<ReservationResponse>(Assert.IsType<OkObjectResult>(restricted.Result).Value);
        Assert.Null(hidden.CancellationFinancial);
        Assert.DoesNotContain("cancellationFinancial", JsonSerializer.Serialize(hidden,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            AdminDetail(db, bookingsAllowed: false, paymentsAllowed: true).GetById(1, default));

        Assert.Null((await Service(db).GetByIdAsync(1)).CancellationFinancial);
    }

    [Fact]
    public void FinancialReadDtoCannotExposeInternalFinanceIdentifiers()
    {
        Assert.Equal(new[]
        {
            "AlreadyHandledByLegacyRefundV1", "CashRefundExecutedAmount", "CashRefundPendingAmount", "Currency",
            "FinalKoochShare", "FinalPropertyShare", "ForfeitedAmount", "Funding", "GrossPaidAmount", "GuestRefundAmount",
            "GuestWalletRestoreAmount", "Mode", "PaidCancellation", "RefundPending"
        }, typeof(ReservationCancellationFinancialStateResponse).GetProperties()
            .Select(property => property.Name).Order());
    }

    private static AdminReservationsController AdminDetail(Kooch.Api.Data.KoochDbContext db,
        bool bookingsAllowed, bool paymentsAllowed)
    {
        var permissions = new Permissions(bookingsAllowed, paymentsAllowed);
        var controller = new AdminReservationsController(
            Service(db), null!, null!, null!, permissions, new ReservationCancellationRequestService(db, permissions))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, Actor.UserId.ToString()),
             new Claim(ClaimTypes.Role, UserRole.AdminAssistant.ToString())], "test"));
        return controller;
    }
}
