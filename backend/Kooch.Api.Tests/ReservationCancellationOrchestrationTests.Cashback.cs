using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationCancellationOrchestrationTests
{
    private static async Task<ReservationCashbackEntitlement> AddCashbackAsync(Kooch.Api.Data.KoochDbContext db)
    {
        return (await new ReservationCashbackEntitlementService(db).CreatePendingAsync(new(
            1, 2, 1, "IRR", 100m, 0m, 100m, 10m,
            CashbackPolicySource.Global, CashbackCalculationMode.Percentage,
            10m, null, null, 50m, 30,
            new DateTime(2026, 9, 27, 8, 30, 0, DateTimeKind.Utc))))!;
    }

    [Fact]
    public async Task CashbackSuccessfulCancellationVoidsPendingAndPreservesImmutableHistory()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var before = await AddCashbackAsync(db);
        var snapshot = (before.GuestPayableSnapshot, before.NonWithdrawableWalletFundingSnapshot,
            before.EligibleBaseSnapshot, before.CashbackAmount, before.PolicySource,
            before.CalculationMode, before.PercentageRateSnapshot,
            before.MaxCashbackPerReservationSnapshot, before.ExpiryDaysSnapshot, before.EligibleAtUtc);
        var financialBefore = await db.CancellationFinancialResolutions.CountAsync();

        await Service(db).CancelAsync(1, Auto(), Actor);
        db.ChangeTracker.Clear();
        var after = await db.ReservationCashbackEntitlements.SingleAsync();
        Assert.Equal(before.Id, after.Id);
        Assert.Equal(CashbackEntitlementStatus.Voided, after.Status);
        Assert.Equal(snapshot, (after.GuestPayableSnapshot, after.NonWithdrawableWalletFundingSnapshot,
            after.EligibleBaseSnapshot, after.CashbackAmount, after.PolicySource,
            after.CalculationMode, after.PercentageRateSnapshot,
            after.MaxCashbackPerReservationSnapshot, after.ExpiryDaysSnapshot, after.EligibleAtUtc));
        Assert.Equal(ReservationStatus.Cancelled, (await db.Reservations.SingleAsync()).Status);
        Assert.Equal(financialBefore + 1, await db.CancellationFinancialResolutions.CountAsync());
        Assert.Equal(100m, (await db.CancellationFinancialResolutions.SingleAsync()).GuestRefundAmount);
        Assert.Empty(await db.WalletAccounts.ToListAsync());
        Assert.Empty(await db.WalletLots.ToListAsync());
        Assert.Empty(await db.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task CashbackMissingEntitlementDoesNotBlockLegacyCancellation()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        await Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        Assert.Equal(ReservationStatus.Cancelled, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.ReservationCashbackEntitlements.ToListAsync());
    }

    [Fact]
    public async Task CashbackAlreadyVoidedStaysVoidedOnCancellationAndReplay()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddCashbackAsync(db);
        await new ReservationCashbackEntitlementService(db).VoidPendingForReservationAsync(1);
        await db.SaveChangesAsync();
        var service = Service(db);
        await service.CancelAsync(1, Auto(), Actor);
        Assert.True((await service.CancelAsync(1, Auto(), Actor)).CancellationOutcome!.IdempotentReplay);
        db.ChangeTracker.Clear();
        Assert.Equal(CashbackEntitlementStatus.Voided,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Equal(1, await db.ReservationCashbackEntitlements.CountAsync());
    }

    [Fact]
    public async Task CashbackGrantedIsNotChangedByCancellation()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var entitlement = await AddCashbackAsync(db);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE ReservationCashbackEntitlements SET Status = 1, GrantedWalletLotId = 77, GrantedWalletEntryId = 78, GrantedAtUtc = {Now.UtcDateTime} WHERE Id = {entitlement.Id}");
        db.ChangeTracker.Clear();
        await Service(db).CancelAsync(1, Auto(), Actor);
        db.ChangeTracker.Clear();
        var after = await db.ReservationCashbackEntitlements.SingleAsync();
        Assert.Equal(CashbackEntitlementStatus.Granted, after.Status);
        Assert.Equal(77, after.GrantedWalletLotId);
        Assert.Equal(78, after.GrantedWalletEntryId);
        Assert.Empty(await db.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task CashbackRequestsReviewAndRejectionDoNotVoidPending()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddCashbackAsync(db);
        var requests = RequestService(db);
        await requests.CreateAsync(2, "R-100001", SupportRequest());
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.NotNull(await requests.GetLatestForAdminAsync(1));
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        await requests.RejectAsync(1, 1, UserRole.SuperAdmin, null);
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        await requests.CreateForSupportAsync(1, 1, UserRole.SuperAdmin, SupportRequest());
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
    }

    [Fact]
    public async Task CashbackPendingRequestResolvesOnlyOnSuccessfulCancellation()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddCashbackAsync(db);
        await RequestService(db).CreateAsync(2, "R-100001", SupportRequest());
        await Service(db).CancelAsync(1, Auto(), Actor);
        Assert.Equal(ReservationCancellationRequestStatus.Resolved,
            (await db.ReservationCancellationRequests.SingleAsync()).Status);
        Assert.Equal(CashbackEntitlementStatus.Voided,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
    }

    [Fact]
    public async Task CashbackFailedCancellationLeavesPending()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddCashbackAsync(db);
        var invalid = Auto();
        invalid.Explanation = " ";
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).CancelAsync(1, invalid, Actor));
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
    }

    [Fact]
    public async Task CashbackFinalSaveFailureRollsBackCancellationAndVoid()
    {
        await using var store = await Store.CreateAsync();
        await using (var seed = store.Open())
        {
            await AddCashbackAsync(seed);
            await RequestService(seed).CreateAsync(2, "R-100001", SupportRequest());
        }
        await using (var failing = store.Open(failOnRequestResolution: true))
            await Assert.ThrowsAsync<InvalidOperationException>(() => Service(failing).CancelAsync(1, Auto(), Actor));
        await using var verify = store.Open();
        Assert.Equal(ReservationStatus.Confirmed, (await verify.Reservations.SingleAsync()).Status);
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await verify.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Equal(ReservationCancellationRequestStatus.Pending,
            (await verify.ReservationCancellationRequests.SingleAsync()).Status);
        Assert.Empty(await verify.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task CashbackDatabaseCancellationFailureRollsBackVoidedState()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await AddCashbackAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RejectCashbackCancellation BEFORE UPDATE ON Reservations
            WHEN NEW.Status = 3 BEGIN SELECT RAISE(ABORT, 'injected cancellation failure'); END;
            """);
        await Assert.ThrowsAnyAsync<Exception>(() => Service(db).CancelAsync(1, Auto(), Actor));
        db.ChangeTracker.Clear();
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await db.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
    }
}
