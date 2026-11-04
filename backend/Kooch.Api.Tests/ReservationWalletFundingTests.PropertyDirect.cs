using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    private const string DirectWalletError =
        "PropertyDirectWalletFundingNotAllowed: Property Direct bookings require gateway-only funding.";

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task PropertyDirect_NewWalletFundingIsRejectedWithoutWrites(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, CommissionType.PropertyReferralCode);
        var credits = await db.Context.WalletEntries.CountAsync();

        // Exercise both the Account facade and direct central-service callers, including retries.
        var account = CoordinationAccountPayment(db);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => account.InitiateAsync(
            1, "O-123456", wallet == 300 ? "" : InternalTestPaymentProvider.ProviderName, "direct", wallet));
        Assert.Equal(DirectWalletError, error.Message);
        foreach (var key in new[] { "direct", "different-key" })
            Assert.Equal(DirectWalletError,
                (await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(wallet, key))).Message);

        await AssertNoNewFundingAsync(db, credits);
    }

    [Fact]
    public async Task PropertyDirect_GuardUsesPersistedChannelEvenWhenTrackedSessionSaysMarketplace()
    {
        using var db = new Database();
        await db.Credit(300);
        var credits = await db.Context.WalletEntries.CountAsync();
        var tracked = await db.Context.BookingSessions.SingleAsync();
        tracked.CommissionType = CommissionType.Direct;
        await db.Context.SaveChangesAsync();
        await db.Context.Database.ExecuteSqlRawAsync("UPDATE BookingSessions SET CommissionType = 2 WHERE Id = 1");
        Assert.Equal(CommissionType.Direct, tracked.CommissionType);

        Assert.Equal(DirectWalletError,
            (await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(300))).Message);
        await AssertNoNewFundingAsync(db, credits);
    }

    [Theory]
    [InlineData(null, 150)]
    [InlineData(null, 300)]
    [InlineData(0, 150)]
    [InlineData(0, 300)]
    [InlineData(1, 150)]
    [InlineData(1, 300)]
    public async Task PropertyDirect_OtherPersistedChannelsRetainWalletFunding(int? channel, decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, channel.HasValue ? (CommissionType)channel.Value : null);
        var result = await db.Checkout(wallet);
        Assert.Equal(wallet, result.WalletAmount);
        if (wallet < 300)
            Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.Confirmed, r.Status));
        Assert.Equal(wallet, (await db.Debits()).Sum(e => e.Amount));
    }

    [Fact]
    public async Task PropertyDirect_GatewayOnlyStillConfirmsWithoutSpendingWallet()
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, CommissionType.PropertyReferralCode);
        var result = await CoordinationAccountPayment(db).InitiateAsync(1, "O-123456",
            InternalTestPaymentProvider.ProviderName, "gateway", 0);
        Assert.Equal(300, result.Amount);
        Assert.Equal(0, result.WalletAmount);
        Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Debits());
        Assert.All(await db.Context.ReservationFinancialSnapshots.ToListAsync(), s =>
        {
            Assert.Equal(CommissionType.PropertyReferralCode, s.CommissionType);
            Assert.Equal(0, s.WalletFundingAmount);
        });
    }

    [Theory]
    [InlineData(150)]
    [InlineData(300)]
    public async Task PropertyDirect_PreexistingFundingReplaysAndCompletesButCannotStartNewFunding(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, CommissionType.PropertyReferralCode);
        // Seed a pre-restriction operation via the historical NULL session policy. Restoring
        // policy 2 then models an already-persisted Direct attempt, including its snapshots.
        (await db.Context.BookingSessions.SingleAsync()).CommissionType = null;
        await db.Context.SaveChangesAsync();
        var original = await db.Checkout(wallet, "historical");
        (await db.Context.BookingSessions.SingleAsync()).CommissionType = CommissionType.PropertyReferralCode;
        await db.Context.SaveChangesAsync();

        var replay = await CoordinationAccountPayment(db).InitiateAsync(1, "O-123456",
            InternalTestPaymentProvider.ProviderName, "historical", wallet);
        Assert.True(replay.IsReplay);
        Assert.Equal(original.PaymentId, replay.PaymentId);
        if (wallet < 300)
        {
            Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
            Assert.True((await db.Callback()).IsDuplicate);
            Assert.Equal(PaymentCallbackApplicationState.Applied,
                (await db.CallbackService().RetryApplicationAsync(original.PaymentId!.Value)).ApplicationState);
        }
        Assert.True((await db.Checkout(wallet, "historical")).FundingCompleted);
        var mismatch = await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(wallet - 1, "historical"));
        Assert.Contains("different funding", mismatch.Message);
        Assert.Equal(DirectWalletError,
            (await Assert.ThrowsAsync<InvalidOperationException>(() => db.Checkout(wallet, "new-attempt"))).Message);
        Assert.Single(await db.Context.BookingFundingAttempts.ToListAsync());
        Assert.Single(await db.Context.WalletHolds.ToListAsync());
        Assert.Equal(wallet, (await db.Debits()).Sum(e => e.Amount));
        Assert.Equal(2, await db.Context.ReservationFinancialSnapshots.CountAsync());
        Assert.All(await db.Context.ReservationFinancialSnapshots.ToListAsync(), s =>
            Assert.Equal(CommissionType.PropertyReferralCode, s.CommissionType));

        var cancellation = CancellationService(db);
        var state = await cancellation.GetCancellationFinancialStateAsync(10);
        var creditsBefore = await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit);
        await cancellation.CancelAsync(10, FundingRequest(state), (1, UserRole.SuperAdmin));
        Assert.Equal(creditsBefore + 1,
            await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit));
        Assert.Equal(wallet / 3, (await db.Context.CancellationSourceDispositions.ToListAsync()).Sum(d => d.WalletRestoreAmount));
        Assert.Equal(100 - wallet / 3,
            (await cancellation.GetCancellationFinancialStateAsync(10)).CashRefundPendingAmount);
    }

    [Fact]
    public async Task PropertyDirect_GatewayRefundDoesNotConvertCashToWalletCredit()
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, CommissionType.PropertyReferralCode);
        await db.Checkout(0);
        await db.Callback();
        var creditsBefore = await db.Context.WalletEntries.CountAsync();
        var cancellation = CancellationService(db);
        var state = await cancellation.GetCancellationFinancialStateAsync(10);
        await cancellation.CancelAsync(10, FundingRequest(state), (1, UserRole.SuperAdmin));
        var refunds = new ReservationRefundService(db.Context,
            new SettlementService(db.Context, TimeProvider.System), TimeProvider.System);
        var result = await refunds.RecordAsync(10, new ReservationRefundRequest
        {
            ReferenceNumber = "bank-refund", Reason = "executed cash refund",
            IdempotencyKey = "direct-refund", RefundedAt = DateTimeOffset.UtcNow.AddMinutes(-1)
        }, 1);
        Assert.Equal(100, result.Amount);
        Assert.Equal(creditsBefore, await db.Context.WalletEntries.CountAsync());
        Assert.Empty(await db.Debits());
        Assert.Equal(0, (await db.Context.CancellationSourceDispositions.ToListAsync()).Sum(d => d.WalletRestoreAmount));
    }

    [Fact]
    public async Task PropertyDirect_ConcurrentWalletRequestsFromIndependentContextsCannotCreateFunding()
    {
        using var db = new Database();
        await db.Credit(300);
        await SetFundingChannelAsync(db, CommissionType.PropertyReferralCode);
        var credits = await db.Context.WalletEntries.CountAsync();
        var connectionString = db.Context.Database.GetDbConnection().ConnectionString;
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = Enumerable.Range(0, 4).Select(i => Task.Run(async () =>
        {
            await start.Task;
            using var connection = new SqliteConnection(connectionString);
            SqliteTestFunctions.RegisterLen(connection);
            await connection.OpenAsync();
            await using var context = new TestContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
            var service = new PaymentService(context, new Availability());
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.InitiateBookingSessionPaymentAsync(new()
            {
                BookingSessionId = 1, Provider = InternalTestPaymentProvider.ProviderName,
                WalletAmount = i % 2 == 0 ? 150 : 300, IdempotencyKey = i < 2 ? "same" : $"key-{i}"
            }));
            Assert.Equal(DirectWalletError, error.Message);
        })).ToArray();
        start.SetResult();
        await Task.WhenAll(tasks);
        await AssertNoNewFundingAsync(db, credits);
    }

    private static async Task SetFundingChannelAsync(Database db, CommissionType? channel)
    {
        (await db.Context.BookingSessions.SingleAsync()).CommissionType = channel;
        foreach (var reservation in await db.Context.Reservations.ToListAsync())
            reservation.CommissionType = channel ?? CommissionType.Direct;
        db.Context.SiteSettings.AddRange(
            new SiteSetting { Key = CommissionPolicyResolver.PropertyReferralLinkSettingKey, Value = "10", IsActive = true },
            new SiteSetting { Key = CommissionPolicyResolver.PropertyReferralCodeSettingKey, Value = "10", IsActive = true });
        await db.Context.SaveChangesAsync();
    }

    private static async Task AssertNoNewFundingAsync(Database db, int originalEntryCount)
    {
        db.Context.ChangeTracker.Clear();
        Assert.Empty(await db.Context.Payments.ToListAsync());
        Assert.Empty(await db.Context.PaymentItems.ToListAsync());
        Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
        Assert.Empty(await db.Context.BookingFundingItems.ToListAsync());
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Context.WalletHoldAllocations.ToListAsync());
        Assert.Equal(originalEntryCount, await db.Context.WalletEntries.CountAsync());
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await db.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await db.Context.ReservationVouchers.ToListAsync());
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status));
    }
}
