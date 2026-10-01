using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(40)]
    [InlineData(100)]
    [InlineData(299.99)]
    [InlineData(300)]
    public async Task CheckoutPreservesExactFundingAndFullFinancialization(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        var result = await db.Checkout(wallet);
        Assert.Equal(300 - wallet, result.Amount);
        Assert.Equal(wallet, result.WalletAmount);
        if (wallet < 300)
        {
            Assert.NotNull(result.PaymentId);
            Assert.Equal(300 - wallet, (await db.Context.Payments.SingleAsync()).Amount);
            Assert.Equal(300 - wallet, (await db.Context.PaymentItems.ToListAsync()).Sum(i => i.AllocatedAmount));
            Assert.Empty(await db.Debits());
            if (wallet > 0) Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.SingleAsync()).Status);
            Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        }
        else
        {
            Assert.Null(result.PaymentId);
            Assert.Null(result.Status);
            Assert.True(result.FundingCompleted);
            Assert.Empty(await db.Context.Payments.ToListAsync());
            Assert.Empty(await db.Context.PaymentItems.ToListAsync());
        }
        db.Context.ChangeTracker.Clear();
        var snapshots = await db.Context.ReservationFinancialSnapshots.OrderBy(s => s.ReservationId).ToListAsync();
        Assert.Equal(2, snapshots.Count);
        Assert.Equal(new[] { 100m, 200m }, snapshots.Select(s => s.GrossAmount));
        Assert.Equal(wallet, snapshots.Sum(s => s.WalletFundingAmount));
        Assert.Equal(300 - wallet, snapshots.Sum(s => s.ExternalPaymentAmount));
        Assert.All(snapshots, s =>
        {
            Assert.Equal(s.GrossAmount, s.WalletFundingAmount + s.ExternalPaymentAmount);
            Assert.Equal(s.GrossAmount, s.CommissionBase);
            Assert.Equal(s.GrossAmount * .1m, s.CommissionAmount);
            Assert.Equal(s.GrossAmount * .9m, s.PropertyPayableAmount);
        });
        Assert.Equal(270, (await db.Context.FinancialEntries.ToListAsync()).Sum(e => e.Amount));
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.Confirmed, r.Status));
        Assert.Equal(2, await db.Context.ReservationVouchers.CountAsync());
        Assert.Equal(wallet, (await db.Debits()).Sum(e => e.Amount));
        Assert.Equal(wallet, (await db.Context.ReservationWalletFundingAllocations.ToListAsync()).Sum(a => a.Amount));
        if (wallet == 0) Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(301)]
    [InlineData(0.001)]
    public async Task InvalidWalletAmountRejectsWithoutPaymentOrHold(decimal amount)
    {
        using var db = new Database();
        await db.Credit(400);
        await Assert.ThrowsAsync<ArgumentException>(() => db.Checkout(amount));
        Assert.Empty(await db.Context.Payments.ToListAsync());
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
    }

    [Fact]
    public async Task InsufficientWalletDoesNotSilentlyReduceRequestedAmount()
    {
        using var db = new Database();
        await db.Credit(10);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(20));
        Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Context.Payments.ToListAsync());
    }

    [Fact]
    public void PublicCheckoutInputDoesNotAcceptWalletOwnerOrLotSelection()
    {
        Assert.Equal(new[] { "IdempotencyKey", "ProviderKey", "WalletAmount" },
            typeof(AccountBookingSessionPaymentRequest).GetProperties().Select(p => p.Name).Order().ToArray());
    }

    [Theory]
    [InlineData(100, 200, 100, 33.34, 66.66)]
    [InlineData(6000000, 4000000, 5000000, 3000000, 2000000)]
    [InlineData(.01, .02, .01, .01, 0)]
    [InlineData(100, 200, 300, 100, 200)]
    [InlineData(100, 200, 299.99, 100, 199.99)]
    public void ProportionalResidualIsExactDeterministicAndBounded(decimal first, decimal second, decimal wallet,
        decimal expectedFirst, decimal expectedSecond)
    {
        var result = BookingWalletFunding.Allocate([
            new Reservation { Id = 20, FinalAmount = second }, new Reservation { Id = 10, FinalAmount = first }], wallet);
        Assert.Equal(new[] { 10, 20 }, result.Select(i => i.ReservationId));
        Assert.Equal(new[] { expectedFirst, expectedSecond }, result.Select(i => i.WalletAmount));
        Assert.Equal(wallet, result.Sum(i => i.WalletAmount));
        Assert.Equal(first + second - wallet, result.Sum(i => i.GuestPayable - i.WalletAmount));
        Assert.All(result, i => Assert.InRange(i.WalletAmount, 0, i.GuestPayable));
    }

    [Theory]
    [InlineData(.01, .01, 0, 0)]
    [InlineData(1, .12, .29, .59)]
    [InlineData(6.76, .8, 1.97, 3.99)]
    [InlineData(6.77, .8, 1.97, 4)]
    public void ThreeUnevenReservationsAssignResidualInStableIdOrder(decimal wallet, decimal first, decimal second, decimal third)
    {
        var result = BookingWalletFunding.Allocate([
            new Reservation { Id = 30, FinalAmount = 4 },
            new Reservation { Id = 10, FinalAmount = .8m },
            new Reservation { Id = 20, FinalAmount = 1.97m }], wallet);
        Assert.Equal(new[] { 10, 20, 30 }, result.Select(i => i.ReservationId));
        Assert.Equal(new[] { first, second, third }, result.Select(i => i.WalletAmount));
        Assert.Equal(wallet, result.Sum(i => i.WalletAmount));
        Assert.Equal(6.77m - wallet, result.Sum(i => i.GuestPayable - i.WalletAmount));
        Assert.All(result, i => Assert.InRange(i.WalletAmount, 0, i.GuestPayable));
    }

    [Fact]
    public async Task ZeroPayableChildRetainsExistingRejectionWithoutCreatingFunding()
    {
        using var db = new Database();
        (await db.Context.Reservations.FindAsync(10))!.FinalAmount = 0;
        await db.Context.SaveChangesAsync();
        await db.Credit(200);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(100));
        Assert.Contains("positive amount", error.Message);
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
    }

    [Fact]
    public async Task SingleReservationAndRejectedChildrenUseOnlyAuthoritativePayableScope()
    {
        using var db = new Database();
        (await db.Context.Reservations.SingleAsync(r => r.Id == 11)).Status = ReservationStatus.Rejected;
        await db.Context.SaveChangesAsync();
        await db.Credit(50);
        var result = await db.Checkout(40);
        Assert.Equal(60, result.Amount);
        Assert.Equal(40, (await db.Context.BookingFundingItems.SingleAsync()).WalletAmount);
        Assert.Equal(60, (await db.Context.PaymentItems.SingleAsync()).AllocatedAmount);
        Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        Assert.Single(await db.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Equal(ReservationStatus.Rejected, (await db.Context.Reservations.FindAsync(11))!.Status);
    }

    [Fact]
    public async Task LotProvenanceMapsConsumedLotsAcrossReservationsWithoutDuplicatingTheirFacts()
    {
        using var db = new Database();
        var expiry = DateTime.UtcNow.AddHours(1);
        var promo = await db.Credit(60, true, expiry);
        var cash = await db.Credit(240);
        await db.Checkout(150);
        await db.Callback();
        var allocations = await db.Context.ReservationWalletFundingAllocations.Include(a => a.ReservationFinancialSnapshot).ToListAsync();
        Assert.Equal(150, allocations.Sum(a => a.Amount));
        Assert.Equal(60, allocations.Where(a => a.WalletLotId == promo).Sum(a => a.Amount));
        Assert.Equal(90, allocations.Where(a => a.WalletLotId == cash).Sum(a => a.Amount));
        Assert.Equal(2, allocations.Where(a => a.WalletLotId == promo).Select(a => a.ReservationFinancialSnapshot.ReservationId).Distinct().Count());
        var lot = await db.Context.WalletLots.FindAsync(promo);
        Assert.False(lot!.IsWithdrawable);
        Assert.Equal(expiry, lot.ExpiresAtUtc);
        Assert.True((await db.Context.WalletLots.FindAsync(cash))!.IsWithdrawable);
        foreach (var snapshot in await db.Context.ReservationFinancialSnapshots.ToListAsync())
            Assert.Equal(snapshot.WalletFundingAmount, allocations.Where(a => a.ReservationFinancialSnapshotId == snapshot.Id).Sum(a => a.Amount));
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task RetryDoesNotDuplicateConsumptionFundingFinanceOrConfirmation(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        var first = await db.Checkout(wallet);
        var replay = await db.Checkout(wallet);
        Assert.True(replay.IsReplay);
        Assert.Equal(first.PaymentId, replay.PaymentId);
        if (wallet < 300)
        {
            await db.Callback();
            Assert.True((await db.Callback()).IsDuplicate);
            var service = db.CallbackService();
            Assert.Equal(PaymentCallbackApplicationState.Applied,
                (await service.RetryApplicationAsync(first.PaymentId!.Value)).ApplicationState);
        }
        Assert.True((await db.Checkout(wallet)).FundingCompleted);
        Assert.Single(await db.Debits());
        Assert.Equal(2, await db.Context.ReservationWalletFundingAllocations.CountAsync());
        Assert.Equal(2, await db.Context.ReservationFinancialSnapshots.CountAsync());
        Assert.Equal(2, await db.Context.FinancialEntries.CountAsync());
        Assert.Equal(2, await db.Context.ReservationVouchers.CountAsync());
        Assert.Equal(2, await db.Context.NotificationLogs.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(wallet - 1));
    }

    [Fact]
    public async Task FailedExternalPaymentReleasesHoldAndNewAttemptGetsItsOwnHold()
    {
        using var db = new Database();
        await db.Credit(150);
        var first = await db.Checkout(100);
        Assert.Equal(PaymentCallbackApplicationState.ProviderRejected, (await db.Callback(false)).ApplicationState);
        Assert.True((await db.Callback(false)).IsDuplicate);
        Assert.Equal(WalletHoldStatus.Released, (await db.Context.WalletHolds.SingleAsync()).Status);
        Assert.Empty(await db.Debits());
        Assert.Equal(150, (await db.Wallet.GetBalanceAsync(1, "IRR")).Balance);
        var second = await db.Checkout(100, "next-attempt");
        Assert.Equal(2, await db.Context.BookingFundingAttempts.CountAsync());
        Assert.Equal(2, await db.Context.WalletHolds.CountAsync());
        // A late successful receipt from the failed attempt must not consume the new hold.
        Assert.Equal(PaymentCallbackApplicationState.Failed,
            (await db.Callback(paymentId: first.PaymentId)).ApplicationState);
        Assert.Empty(await db.Debits());
        var current = await db.Context.BookingFundingAttempts.SingleAsync(a => a.PaymentId == second.PaymentId);
        Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.FindAsync(current.WalletHoldId))!.Status);
        Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        Assert.Equal(100, (await db.Debits()).Sum(e => e.Amount));
        Assert.All(await db.Context.ReservationFinancialSnapshots.ToListAsync(), s => Assert.Equal(current.Id, s.BookingFundingAttemptId));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReleasedOrExpiredHoldCannotConfirmReservation(bool expired)
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Checkout(100);
        var hold = await db.Context.WalletHolds.SingleAsync();
        if (expired)
            await db.Context.Database.ExecuteSqlInterpolatedAsync($"UPDATE WalletHolds SET ExpiresAtUtc={DateTime.UtcNow.AddMinutes(-1)} WHERE Id={hold.Id}");
        else await db.Wallet.ReleaseHoldAsync(1, "IRR", hold.Id);
        Assert.Equal(PaymentCallbackApplicationState.Failed, (await db.Callback()).ApplicationState);
        Assert.Empty(await db.Debits());
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status));
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task FailureAfterFundingWritesRollsBackEntireApplication(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        db.Failure.Enabled = true;
        if (wallet == 300) await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(wallet));
        else
        {
            await db.Checkout(wallet);
            Assert.Equal(PaymentCallbackApplicationState.Failed, (await db.Callback()).ApplicationState);
        }
        db.Context.ChangeTracker.Clear();
        Assert.Empty(await db.Debits());
        Assert.Empty(await db.Context.ReservationWalletFundingAllocations.ToListAsync());
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await db.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await db.Context.ReservationVouchers.ToListAsync());
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status));
        if (wallet == 300) Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        else Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.SingleAsync()).Status);
    }

    [Fact]
    public async Task WalletApplicationCannotCommitConsumptionOutsideCallerTransaction()
    {
        using var db = new Database();
        await db.Credit(150);
        await db.Checkout(150);
        var payment = await db.Context.Payments.SingleAsync();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new PaymentDomainApplicationHandler(db.Context, new Availability()).ApplyAsync(payment));
        Assert.Contains("transaction", error.Message);
        Assert.Empty(await db.Debits());
        Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.SingleAsync()).Status);
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
    }

    [Theory]
    [InlineData("amount")]
    [InlineData("lot")]
    [InlineData("snapshot")]
    [InlineData("delete")]
    public async Task FinalWalletProvenanceIsImmutable(string change)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(300);
        var row = await db.Context.ReservationWalletFundingAllocations.FirstAsync();
        if (change == "amount") row.Amount++;
        if (change == "lot") row.WalletLotId++;
        if (change == "snapshot") row.ReservationFinancialSnapshotId++;
        if (change == "delete") db.Context.Remove(row);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task WalletFundedReservationCannotEnterCashCancellation(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(wallet);
        if (wallet < 300) await db.Callback();
        var service = new ReservationService(db.Context, new StubReservationAvailabilityService(),
            new StubReservationPricingService(), new StubReservationNumberGenerator(), new RecordingNotificationService(),
            new RecordingReservationNotificationDispatcher(), new RecordingAuditLogService(), new StubPermissionService(true),
            new StubPropertyAuthorizationService(true), new ReservationStatusWorkflow(), new Availability(), new TestHostEnvironment());
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(10, new ReservationCancellationRequest
        {
            Reason = ReservationCancellationReason.GuestRequest, Explanation = "guest requested cancellation", IdempotencyKey = "cancel-wallet"
        }, (1, UserRole.SuperAdmin)));
        Assert.StartsWith("WalletFundingCancellationUnsupported:", error.Message);
        db.Context.ChangeTracker.Clear();
        Assert.All(await db.Context.Reservations.ToListAsync(), r =>
        {
            Assert.Equal(ReservationStatus.Confirmed, r.Status);
            Assert.Null(r.CancellationIdempotencyKey);
        });
        Assert.Empty(await db.Context.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.Context.RefundRecords.ToListAsync());
        Assert.Equal(2, await db.Context.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task OwnershipFkRejectsCrossAccountProvenance()
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Wallet.CreateCreditAsync(new(2, "IRR", 50, WalletSourceType.CashReceived, null));
        await db.Checkout(300);
        var source = await db.Context.WalletHoldAllocations.SingleAsync();
        var otherLot = await db.Context.WalletLots.SingleAsync(l => l.WalletAccount.UserId == 2);
        var snapshot = await db.Context.ReservationFinancialSnapshots.FirstAsync();
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() => db.Context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO ReservationWalletFundingAllocations (ReservationFinancialSnapshotId,WalletHoldAllocationId,WalletLotId,WalletAccountId,Amount,CreatedAtUtc,IsDeleted) VALUES ({snapshot.Id},{source.Id},{otherLot.Id},{otherLot.WalletAccountId},1,{DateTime.UtcNow},0)"));
    }

    [Fact]
    public void SqlServerFundingModelRetainsExternalLinkAndNoCascadeHistory()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        Assert.True(model.FindEntityType(typeof(ReservationFinancialSnapshot))!.FindProperty("PaymentId")!.IsNullable);
        foreach (var type in new[] { typeof(BookingFundingAttempt), typeof(BookingFundingItem), typeof(ReservationWalletFundingAllocation) })
            Assert.All(model.FindEntityType(type)!.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
    }

    [Fact]
    public void MigrationIsScopedAndPreservesHistoricalExternalFunding()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var migration = new Kooch.Api.Migrations.AddReservationWalletFunding();
        var operations = migration.UpOperations;
        Assert.Equal(new[] { "BookingFundingAttempts", "BookingFundingItems", "ReservationWalletFundingAllocations" },
            operations.OfType<CreateTableOperation>().Select(o => o.Name).Order());
        Assert.DoesNotContain(operations, o => o is DropTableOperation or DropColumnOperation or SqlOperation or UpdateDataOperation);
        var payment = Assert.Single(operations.OfType<AlterColumnOperation>());
        Assert.Equal("PaymentId", payment.Name);
        Assert.True(payment.IsNullable);
        var additions = operations.OfType<AddColumnOperation>().ToArray();
        Assert.Equal(3, additions.Length);
        Assert.All(additions, o => Assert.Equal("ReservationFinancialSnapshots", o.Table));
        Assert.Equal(0m, additions.Single(o => o.Name == "WalletFundingAmount").DefaultValue);
        Assert.True(additions.Single(o => o.Name == "BookingFundingAttemptId").IsNullable);
        Assert.Equal("CAST([GrossAmount] - [WalletFundingAmount] AS decimal(18,2))",
            additions.Single(o => o.Name == "ExternalPaymentAmount").ComputedColumnSql);
        var foreignKeys = operations.OfType<CreateTableOperation>().SelectMany(o => o.ForeignKeys)
            .Concat(operations.OfType<AddForeignKeyOperation>());
        Assert.All(foreignKeys, fk => Assert.Equal(ReferentialAction.NoAction, fk.OnDelete));
        var sql = context.GetService<IMigrator>().GenerateScript("20260930135406_AddWalletHolds",
            "20260930144456_AddReservationWalletFunding");
        Assert.Contains("[ExternalPaymentAmount] AS CAST([GrossAmount] - [WalletFundingAmount] AS decimal(18,2)) PERSISTED", sql);
        Assert.Contains("[WalletFundingAmount] decimal(18,2) NOT NULL DEFAULT 0.0", sql);
        Assert.Contains("WHERE [PaymentId] IS NULL", sql);
        Assert.DoesNotContain("ON DELETE CASCADE", sql);
    }

    [Fact]
    public async Task AuthenticatedCheckoutUsesSessionOwnerAndWalletOnlyNeedsNoProvider()
    {
        using var db = new Database();
        await db.Credit(300);
        var service = new AccountBookingSessionPaymentService(db.Context, new PaymentService(db.Context, new Availability()),
            [new InternalTestPaymentProvider("secret")]);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.InitiateAsync(2, "O-123456", "", "key", 300));
        var result = await service.InitiateAsync(1, "O-123456", "", "key", 300);
        Assert.Null(result.PaymentId);
        Assert.True(result.FundingCompleted);
        Assert.Equal(300, result.WalletAmount);
        Assert.Equal(0, result.Amount);
        Assert.Equal("/booking/sessions/O-123456", result.CheckoutDestination);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SuccessfulWalletOnlyRetryIsNotReportedAsPreviousPaymentFailure(bool rejectedChild)
    {
        using var db = new Database();
        if (rejectedChild)
        {
            (await db.Context.Reservations.FindAsync(11))!.Status = ReservationStatus.Rejected;
            await db.Context.SaveChangesAsync();
        }
        await db.Credit(300);
        await db.Checkout(50);
        await db.Callback(false);
        var completed = await db.Checkout(rejectedChild ? 100 : 300, "wallet-only-retry");
        Assert.True(completed.FundingCompleted);
        Assert.Null(completed.PaymentId);
        var sessions = await new BookingSessionQueryService(db.Context).GetForClientAsync(1, new AccountBookingSessionListQuery());
        Assert.Equal("PaymentSuccessful", Assert.Single(sessions.Items).DerivedStatus);
        // Keep the real failed external payment as history; no synthetic successful Payment.
        Assert.Equal(PaymentStatus.Failed, (await db.Context.Payments.SingleAsync()).Status);
        Assert.Equal(rejectedChild ? 1 : 2, await db.Context.ReservationVouchers.CountAsync());
    }

    [Fact]
    public async Task HoldDeadlineMatchesPayableScopeAndExpiredSourceLotStillFundsCallback()
    {
        using var db = new Database();
        var lotId = await db.Credit(100, true, DateTime.UtcNow.AddMinutes(5));
        await db.Checkout(100);
        var hold = await db.Context.WalletHolds.SingleAsync();
        Assert.Equal((await db.Context.Reservations.FirstAsync()).PaymentExpiresAtUtc, hold.ExpiresAtUtc);
        // Simulate clock crossing the source expiry without waiting for the checkout deadline.
        await db.Context.Database.ExecuteSqlInterpolatedAsync($"UPDATE WalletLots SET ExpiresAtUtc={DateTime.UtcNow.AddMinutes(-1)} WHERE Id={lotId}");
        Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        Assert.Equal(lotId, (await db.Debits()).Single().WalletLotId);
    }

    [Fact]
    public async Task AlteredExternalPlanFailsWithoutSpendingWallet()
    {
        using var db = new Database();
        await db.Credit(150);
        await db.Checkout(150);
        var items = await db.Context.PaymentItems.OrderBy(i => i.ReservationId).ToArrayAsync();
        items[0].AllocatedAmount++;
        items[1].AllocatedAmount--;
        await db.Context.SaveChangesAsync();
        Assert.Equal(PaymentCallbackApplicationState.Failed, (await db.Callback()).ApplicationState);
        Assert.Empty(await db.Debits());
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task CashRefundAndResolutionServicesRejectWalletFunding(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(wallet);
        if (wallet < 300) await db.Callback();
        var settlements = new SettlementService(db.Context, TimeProvider.System);
        var refunds = new ReservationRefundService(db.Context, settlements, TimeProvider.System);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => refunds.RecordAsync(10, new ReservationRefundRequest
        {
            ReferenceNumber = "reference", Reason = "refund", IdempotencyKey = "refund-key", RefundedAt = DateTimeOffset.UtcNow.AddMinutes(-1)
        }, 1));
        Assert.Contains("wallet", error.Message, StringComparison.OrdinalIgnoreCase);
        var resolution = new CancellationFinancialResolutionService(db.Context, settlements, TimeProvider.System);
        var resolutionError = await Assert.ThrowsAsync<InvalidOperationException>(() => resolution.ResolveAsync(
            new CancellationFinancialResolutionRequest { ReservationId = 10, Reason = "cancel", IdempotencyKey = "cancel-key" }, 1));
        Assert.Contains("wallet", resolutionError.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Context.RefundRecords.ToListAsync());
    }

    [Theory]
    [InlineData("plan")]
    [InlineData("attempt")]
    [InlineData("append")]
    public async Task FinalizedFundingCannotBeRewrittenOrExtended(string operation)
    {
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(300);
        if (operation == "plan") (await db.Context.BookingFundingItems.FirstAsync()).WalletAmount--;
        if (operation == "attempt") (await db.Context.BookingFundingAttempts.SingleAsync()).IdempotencyKey = "new-key";
        if (operation == "append")
        {
            var row = await db.Context.ReservationWalletFundingAllocations.FirstAsync();
            db.Context.ReservationWalletFundingAllocations.Add(new()
            { ReservationFinancialSnapshotId = row.ReservationFinancialSnapshotId, WalletHoldAllocationId = row.WalletHoldAllocationId,
                WalletLotId = row.WalletLotId, WalletAccountId = row.WalletAccountId, Amount = 1 });
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    private sealed class FailAfterFinalSave : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }
        public bool WaitForCancellationSources { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (Enabled && eventData.Context!.Set<ReservationWalletFundingAllocation>().Local.Count > 0 &&
                (!WaitForCancellationSources || eventData.Context.Set<CancellationSourceDisposition>().Local.Count > 0))
                throw new InvalidOperationException("Injected failure after final funding persistence");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Database : IDisposable
    {
        private readonly string path = Path.GetTempFileName();
        public TestContext Context { get; }
        public FailAfterFinalSave Failure { get; } = new();
        public WalletService Wallet => new(Context, TimeProvider.System);
        public Database()
        {
            Context = new TestContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite($"Data Source={path};Pooling=False")
                .AddInterceptors(Failure).Options);
            Context.Database.EnsureCreated();
            Context.Users.AddRange(new User { Id = 1, FirstName = "Wallet", LastName = "Guest" }, new User { Id = 2 });
            Context.Destinations.Add(new Destination { Id = 1, Name = "City", Slug = "city" });
            Context.Properties.Add(new Property { Id = 1, OwnerId = 1, DestinationId = 1, Name = "Property", Slug = "property" });
            Context.SiteSettings.Add(new SiteSetting { Key = CommissionPolicyResolver.DirectSettingKey, Value = "10", IsActive = true });
            Context.BookingSessions.Add(new BookingSession { Id = 1, ClientId = 1, PropertyId = 1, Currency = "IRR", SessionCode = "O-123456" });
            var deadline = DateTime.UtcNow.AddMinutes(30);
            foreach (var id in new[] { 10, 11 })
            {
                Context.RoomTypes.Add(new RoomType { Id = id, PropertyId = 1, Name = $"Room {id}", Slug = $"room-{id}", TotalInventory = 1 });
                Context.Reservations.Add(new Reservation
                {
                    Id = id, BookingSessionId = 1, ClientId = 1, PropertyId = 1, RoomTypeId = id,
                    ReservationNumber = $"R-{100000 + id}", FinalAmount = id == 10 ? 100 : 200, Currency = "IRR",
                    CheckInDate = new DateOnly(2036, 1, 1), CheckOutDate = new DateOnly(2036, 1, 2),
                    AdultCount = 1, Status = ReservationStatus.ApprovedAwaitingPayment, PaymentExpiresAtUtc = deadline
                });
            }
            Context.SaveChanges();
        }
        public Task<int> Credit(decimal amount, bool promotional = false, DateTime? expiry = null) => Wallet.CreateCreditAsync(new(
            1, "IRR", amount, promotional ? WalletSourceType.PromotionalCredit : WalletSourceType.CashReceived, expiry));
        public Task<BookingSessionPaymentInitiationResult> Checkout(decimal amount, string key = "checkout") =>
            new PaymentService(Context, new Availability()).InitiateBookingSessionPaymentAsync(new()
            { BookingSessionId = 1, Provider = InternalTestPaymentProvider.ProviderName, WalletAmount = amount, IdempotencyKey = key });
        public Task<List<WalletEntry>> Debits() => Context.WalletEntries.Where(e => e.Direction == WalletEntryDirection.Debit).ToListAsync();
        public PaymentCallbackService CallbackService() => new(Context, [new InternalTestPaymentProvider("secret")],
            new PaymentDomainApplicationHandler(Context, new Availability()));
        public async Task<PaymentCallbackResult> Callback(bool success = true, int? paymentId = null)
        {
            var payment = paymentId.HasValue ? await Context.Payments.SingleAsync(p => p.Id == paymentId)
                : await Context.Payments.OrderByDescending(p => p.Id).FirstAsync();
            var body = InternalTestPaymentProvider.SerializePayload(new InternalTestPaymentCallbackPayload
            { PaymentId = payment.Id, ProviderEventId = $"event-{payment.Id}-{success}", TransactionReference = $"reference-{payment.Id}",
                Amount = payment.Amount, Currency = "IRR", IsSuccessful = success, ProviderOccurredAtUtc = DateTime.UtcNow });
            return await CallbackService().ReceiveAsync(InternalTestPaymentProvider.ProviderName, new(body,
                new Dictionary<string, string> { [InternalTestPaymentProvider.SignatureHeaderName] = InternalTestPaymentProvider.CreateSignature(body, "secret") }));
        }
        public void Dispose() { Context.Dispose(); File.Delete(path); }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            foreach (var type in new[] { typeof(Reservation), typeof(BookingSession), typeof(Payment), typeof(WalletAccount) })
                builder.Entity(type).Property("RowVersion").ValueGeneratedNever();
            // SQLite maps decimal to TEXT by default, making SQL CHECK column comparisons
            // lexical. Use numeric affinity here; SQL Server keeps the real decimal(18,2) model.
            foreach (var type in new[] { typeof(BookingFundingItem), typeof(ReservationFinancialSnapshot),
                typeof(CancellationFinancialResolution), typeof(CancellationSourceDisposition) })
                foreach (var property in builder.Model.FindEntityType(type)!.GetProperties().Where(p => p.ClrType == typeof(decimal)))
                    builder.Entity(type).Property(property.Name).HasColumnType("decimal(18,2)");
            builder.Entity<ReservationFinancialSnapshot>().Property(s => s.ExternalPaymentAmount)
                .HasComputedColumnSql("ROUND([GrossAmount] - [WalletFundingAmount], 2)", stored: true);
        }
    }

    private sealed class Availability : IEffectiveAvailabilityService
    {
        public Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(IReadOnlyCollection<int> roomTypeIds,
            DateOnly checkInDate, DateOnly checkOutDate, int? excludedReservationId = null, CancellationToken cancellationToken = default)
        {
            IReadOnlyDictionary<int, EffectiveRoomTypeAvailability> result = roomTypeIds.ToDictionary(id => id, id => new EffectiveRoomTypeAvailability
            {
                RoomTypeId = id, Nights = new Dictionary<DateOnly, EffectiveAvailabilityNight>
                { [checkInDate] = new() { Date = checkInDate, ConfiguredCapacity = 1, ClaimedCapacity = 1,
                    ConfiguredStatus = AvailabilityStatus.Available, EffectiveStatus = AvailabilityStatus.Available } }
            });
            return Task.FromResult(result);
        }
    }
}
