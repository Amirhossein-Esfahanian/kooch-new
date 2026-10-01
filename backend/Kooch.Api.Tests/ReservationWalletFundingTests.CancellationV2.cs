using System.Text.Json;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    private static ReservationService CancellationService(Database db) => new(db.Context,
        new StubReservationAvailabilityService(), new StubReservationPricingService(), new StubReservationNumberGenerator(),
        new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(), new RecordingAuditLogService(),
        new StubPermissionService(true), new StubPropertyAuthorizationService(true), new ReservationStatusWorkflow(),
        new Availability(), new TestHostEnvironment(), new CancellationFinancialResolutionService(db.Context,
            new SettlementService(db.Context, TimeProvider.System), TimeProvider.System));

    private static ReservationCancellationRequest FundingRequest(ReservationCancellationFinancialStateResponse state,
        string action = "restore", string key = "v2") => new()
    {
        Reason = ReservationCancellationReason.GuestRequest, Explanation = "Explicit funding decision", IdempotencyKey = key,
        FinancialResolution = new()
        {
            Mode = CancellationFinancialResolutionMode.ManualFundingV2, FinalPropertyShare = 0, FinalKoochShare = 0,
            ForfeitedAmount = action == "forfeit" ? state.GrossPaidAmount : 0,
            SourceDispositions = state.Funding!.Sources.Select(s => new CancellationSourceDecision(s.SourceToken,
                action == "cash" || action == "restore" && s.SourceType == "ExternalPayment" ? s.FundedAmount : 0,
                action == "restore" && s.SourceType != "ExternalPayment" ? s.FundedAmount : 0,
                action == "forfeit" ? s.FundedAmount : 0)).ToList()
        }
    };

    [Theory]
    [InlineData(0, false)]
    [InlineData(150, false)]
    [InlineData(300, false)]
    [InlineData(150, true)]
    [InlineData(300, true)]
    public async Task CancellationV2ProjectsAndRestoresOriginalSources(decimal wallet, bool promo)
    {
        using var db = new Database();
        await db.Credit(300, promo, DateTime.UtcNow.AddHours(1));
        await db.Checkout(wallet);
        if (wallet < 300) await db.Callback();
        var service = CancellationService(db);
        var state = await service.GetCancellationFinancialStateAsync(10);
        Assert.Equal(100, state.GrossPaidAmount);
        Assert.Equal(wallet / 3, state.Funding!.WalletAmount);
        Assert.Equal(100 - wallet / 3, state.Funding.ExternalAmount);
        Assert.Equal(promo ? wallet / 3 : 0, state.Funding.NonWithdrawableWalletAmount);
        Assert.Equal(promo ? 0 : wallet / 3, state.Funding.WithdrawableWalletAmount);
        var json = JsonSerializer.Serialize(state.Funding);
        Assert.DoesNotContain("PaymentId", json);
        Assert.DoesNotContain("WalletLotId", json);
        var beforeLot = await db.Context.WalletLots.AsNoTracking().SingleAsync();
        var creditsBefore = await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit);
        var request = FundingRequest(state);
        await service.CancelAsync(10, request, (1, UserRole.SuperAdmin));
        Assert.True((await service.CancelAsync(10, request, (1, UserRole.SuperAdmin))).CancellationOutcome!.IdempotentReplay);
        Assert.Equal(creditsBefore + (wallet > 0 ? 1 : 0), await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit));
        var dispositions = await db.Context.CancellationSourceDispositions.AsNoTracking().ToListAsync();
        Assert.Equal(state.Funding.Sources.Count, dispositions.Count);
        Assert.Equal(wallet / 3, dispositions.Sum(d => d.WalletRestoreAmount));
        var lot = await db.Context.WalletLots.AsNoTracking().SingleAsync();
        Assert.Equal(beforeLot.Id, lot.Id);
        Assert.Equal(beforeLot.SourceType, lot.SourceType);
        Assert.Equal(beforeLot.IsWithdrawable, lot.IsWithdrawable);
        Assert.Equal(beforeLot.ExpiresAtUtc, lot.ExpiresAtUtc);
        Assert.Equal(ReservationStatus.Cancelled, (await db.Context.Reservations.FindAsync(10))!.Status);
        var final = await service.GetCancellationFinancialStateAsync(10);
        Assert.Equal(wallet / 3, final.GuestWalletRestoreAmount);
        Assert.Equal(100 - wallet / 3, final.CashRefundPendingAmount);
        Assert.All(final.Funding!.Sources, s => Assert.Equal(0, s.RemainingDispositionAmount));
        request.FinancialResolution!.SourceDispositions = request.FinancialResolution.SourceDispositions!
            .Select(s => s with { NotReturnedAmount = s.NotReturnedAmount + 1 }).ToArray();
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(10, request, (1, UserRole.SuperAdmin)));
    }

    [Theory]
    [InlineData("negative")]
    [InlineData("precision")]
    [InlineData("over")]
    [InlineData("under")]
    [InlineData("unknown")]
    [InlineData("cross-reservation")]
    [InlineData("duplicate")]
    [InlineData("missing")]
    [InlineData("noncash")]
    [InlineData("external-restore")]
    [InlineData("overall")]
    public async Task CancellationV2RejectsInvalidManualDecisionsAtomically(string error)
    {
        using var db = new Database();
        await db.Credit(300, true);
        await db.Checkout(150);
        await db.Callback();
        var service = CancellationService(db);
        var state = await service.GetCancellationFinancialStateAsync(10);
        var request = FundingRequest(state);
        var rows = request.FinancialResolution!.SourceDispositions!.ToArray();
        var walletIndex = state.Funding!.Sources.ToList().FindIndex(s => s.SourceType != "ExternalPayment");
        if (error == "negative") rows[walletIndex] = rows[walletIndex] with { WalletRestoreAmount = -1, NotReturnedAmount = 51 };
        if (error == "precision") rows[walletIndex] = rows[walletIndex] with { WalletRestoreAmount = 49.999m, NotReturnedAmount = .001m };
        if (error == "over") rows[walletIndex] = rows[walletIndex] with { WalletRestoreAmount = 51 };
        if (error == "under") rows[walletIndex] = rows[walletIndex] with { WalletRestoreAmount = 49 };
        if (error == "unknown") rows[walletIndex] = rows[walletIndex] with { SourceToken = "unknown" };
        if (error == "cross-reservation") rows[walletIndex] = rows[walletIndex] with
            { SourceToken = (await service.GetCancellationFinancialStateAsync(11)).Funding!.Sources.Last().SourceToken };
        if (error == "noncash") rows[walletIndex] = rows[walletIndex] with { CashRefundAmount = 50, WalletRestoreAmount = 0 };
        if (error == "external-restore") rows[0] = rows[0] with { CashRefundAmount = 0, WalletRestoreAmount = 50 };
        if (error == "duplicate") rows[0] = rows[walletIndex];
        if (error == "missing") rows = [];
        if (error == "overall") request.FinancialResolution.FinalKoochShare = 1;
        request.FinancialResolution.SourceDispositions = rows;
        var before = await db.Context.WalletEntries.CountAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => service.CancelAsync(10, request, (1, UserRole.SuperAdmin)));
        db.Context.ChangeTracker.Clear();
        Assert.Empty(await db.Context.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.Context.CancellationSourceDispositions.ToListAsync());
        Assert.Equal(before, await db.Context.WalletEntries.CountAsync());
        Assert.Equal(ReservationStatus.Confirmed, (await db.Context.Reservations.FindAsync(10))!.Status);
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task CancellationV2CashExecutionUsesEntitlementWithoutFakePayment(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(wallet);
        if (wallet < 300) await db.Callback();
        var service = CancellationService(db);
        await service.CancelAsync(10, FundingRequest(await service.GetCancellationFinancialStateAsync(10), "cash"), (1, UserRole.SuperAdmin));
        var refunds = new ReservationRefundService(db.Context, new SettlementService(db.Context, TimeProvider.System), TimeProvider.System);
        var request = new ReservationRefundRequest { ReferenceNumber = "bank", Reason = "executed", IdempotencyKey = "cash-execution", RefundedAt = DateTimeOffset.UtcNow.AddMinutes(-1) };
        var result = await refunds.RecordAsync(10, request, 1);
        Assert.Equal(100, result.Amount);
        Assert.Null(result.PaymentId);
        Assert.True((await refunds.RecordAsync(10, request, 1)).IdempotentReplay);
        request.ReferenceNumber = "different";
        await Assert.ThrowsAsync<InvalidOperationException>(() => refunds.RecordAsync(10, request, 1));
        request.IdempotencyKey = "another";
        await Assert.ThrowsAsync<InvalidOperationException>(() => refunds.RecordAsync(10, request, 1));
        Assert.Single(await db.Context.CancellationCashRefundExecutions.ToListAsync());
        Assert.Empty(await db.Context.RefundRecords.ToListAsync());
        Assert.Equal(wallet < 300 ? 1 : 0, await db.Context.Payments.CountAsync());
        var state = await service.GetCancellationFinancialStateAsync(10);
        Assert.Equal(100, state.CashRefundExecutedAmount);
        Assert.Equal(0, state.CashRefundPendingAmount);
        Assert.False(state.RefundPending);
    }

    [Fact]
    public async Task CancellationV2ForfeitDoesNotPostAnotherDebitOrCredit()
    {
        using var db = new Database();
        await db.Credit(300, true);
        await db.Checkout(300);
        var before = await db.Context.WalletEntries.CountAsync();
        var service = CancellationService(db);
        await service.CancelAsync(10, FundingRequest(await service.GetCancellationFinancialStateAsync(10), "forfeit"), (1, UserRole.SuperAdmin));
        Assert.Equal(before, await db.Context.WalletEntries.CountAsync());
        Assert.Equal(100, (await db.Context.CancellationFinancialResolutions.SingleAsync()).ForfeitedAmount);
    }

    [Fact]
    public async Task CancellationV2ExpiredRestoreRetainsExpiryAndStaysUnavailable()
    {
        using var db = new Database();
        var lot = await db.Credit(300, true, DateTime.UtcNow.AddHours(1));
        await db.Checkout(300);
        var expired = DateTime.UtcNow.AddMinutes(-1);
        await db.Context.Database.ExecuteSqlInterpolatedAsync($"UPDATE WalletLots SET ExpiresAtUtc={expired} WHERE Id={lot}");
        db.Context.ChangeTracker.Clear();
        var service = CancellationService(db);
        var state = await service.GetCancellationFinancialStateAsync(10);
        Assert.True(state.Funding!.Sources.Single().Expired);
        await service.CancelAsync(10, FundingRequest(state), (1, UserRole.SuperAdmin));
        Assert.Equal(0, (await db.Wallet.GetBalanceAsync(1, "IRR")).Balance);
        Assert.Equal(expired, (await db.Context.WalletLots.SingleAsync()).ExpiresAtUtc);
    }

    [Fact]
    public async Task CancellationV2PartialSplitAndOuterRollback()
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(300);
        var service = CancellationService(db);
        var request = FundingRequest(await service.GetCancellationFinancialStateAsync(10));
        request.FinancialResolution!.SourceDispositions = request.FinancialResolution.SourceDispositions!
            .Select(s => s with { CashRefundAmount = 20, WalletRestoreAmount = 30, NotReturnedAmount = 50 }).ToArray();
        request.FinancialResolution.FinalPropertyShare = 20;
        request.FinancialResolution.FinalKoochShare = 10;
        request.FinancialResolution.ForfeitedAmount = 20;
        var before = await db.Context.WalletEntries.CountAsync();
        db.Failure.Enabled = true;
        db.Failure.WaitForCancellationSources = true;
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(10, request, (1, UserRole.SuperAdmin)));
        db.Failure.Enabled = false;
        db.Context.ChangeTracker.Clear();
        Assert.Equal(before, await db.Context.WalletEntries.CountAsync());
        Assert.Empty(await db.Context.CancellationFinancialResolutions.ToListAsync());
        await service.CancelAsync(10, request, (1, UserRole.SuperAdmin));
        var result = await db.Context.CancellationFinancialResolutions.SingleAsync();
        Assert.Equal(result.GrossPaidAmount, result.GuestRefundAmount + result.GuestWalletRestoreAmount + result.ForfeitedAmount + result.FinalPropertyShare + result.FinalKoochShare);
        Assert.Equal(30, result.GuestWalletRestoreAmount);
    }

    [Theory]
    [InlineData("resolution")]
    [InlineData("source")]
    [InlineData("execution")]
    public async Task CancellationV2HistoryRemainsImmutable(string kind)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(300);
        var service = CancellationService(db);
        await service.CancelAsync(10, FundingRequest(await service.GetCancellationFinancialStateAsync(10), "cash"), (1, UserRole.SuperAdmin));
        if (kind == "resolution") (await db.Context.CancellationFinancialResolutions.SingleAsync()).ForfeitedAmount++;
        if (kind == "source") (await db.Context.CancellationSourceDispositions.SingleAsync()).CashRefundAmount++;
        if (kind == "execution")
        {
            await new ReservationRefundService(db.Context, new SettlementService(db.Context, TimeProvider.System), TimeProvider.System)
                .RecordAsync(10, new() { ReferenceNumber = "bank", Reason = "paid", IdempotencyKey = "refund", RefundedAt = DateTimeOffset.UtcNow.AddMinutes(-1) }, 1);
            (await db.Context.CancellationCashRefundExecutions.SingleAsync()).Amount++;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }
}
