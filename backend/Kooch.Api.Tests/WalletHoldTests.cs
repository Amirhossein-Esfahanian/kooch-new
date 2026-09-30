using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services.Wallet;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletHoldTests
{
    private static readonly DateTime Now = new(2026, 9, 30, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void MigrationOnlyAddsWalletHoldsWithNoActionOwnershipAndChecks()
    {
        var operations = new AddWalletHolds().UpOperations;
        var tables = operations.OfType<CreateTableOperation>().ToArray();
        Assert.Equal(new[] { "WalletHoldAllocations", "WalletHolds" },
            tables.Select(table => table.Name).Order().ToArray());
        Assert.All(operations, operation => Assert.True(operation is CreateTableOperation or CreateIndexOperation));
        Assert.All(operations.OfType<CreateIndexOperation>(), index => Assert.StartsWith("WalletHold", index.Table));
        Assert.All(tables.SelectMany(table => table.ForeignKeys),
            foreignKey => Assert.Equal(ReferentialAction.NoAction, foreignKey.OnDelete));
        var holds = Assert.Single(tables, table => table.Name == "WalletHolds");
        var allocations = Assert.Single(tables, table => table.Name == "WalletHoldAllocations");
        Assert.Contains(holds.CheckConstraints, check => check.Name == "CK_WalletHolds_Amount");
        Assert.Contains(holds.CheckConstraints, check => check.Name == "CK_WalletHolds_State");
        Assert.Contains(allocations.CheckConstraints, check => check.Name == "CK_WalletHoldAllocations_Amount");
        Assert.Contains(allocations.ForeignKeys, foreignKey =>
            foreignKey.Columns.SequenceEqual(new[] { "WalletHoldId", "WalletAccountId" }) &&
            foreignKey.PrincipalColumns!.SequenceEqual(new[] { "Id", "WalletAccountId" }));
        Assert.Contains(allocations.ForeignKeys, foreignKey =>
            foreignKey.Columns.SequenceEqual(new[] { "WalletLotId", "WalletAccountId" }) &&
            foreignKey.PrincipalColumns!.SequenceEqual(new[] { "Id", "WalletAccountId" }));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("0.001")]
    public async Task InvalidAmountIsRejected(string value)
    {
        using var db = new Database();
        await db.Credit(100);
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateHoldAsync(1, "IRR",
            decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture), Now.AddMinutes(10)));
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    public async Task DeadlineMustBeFuture(int minutes)
    {
        using var db = new Database();
        await db.Credit(100);
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateHoldAsync(1, "IRR", 10, Now.AddMinutes(minutes)));
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateHoldAsync(1, "IRR", 10,
            DateTime.SpecifyKind(Now.AddMinutes(10), DateTimeKind.Unspecified)));
    }

    [Fact]
    public async Task InsufficientBalanceCreatesNoPartialHoldOrLedgerEntry()
    {
        using var db = new Database();
        await db.Credit(100);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(100.01m));
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Context.WalletHoldAllocations.ToListAsync());
        Assert.Single(await db.Context.WalletEntries.ToListAsync());
        Assert.Equal(100, (await db.Balance()).Balance);
    }

    [Fact]
    public async Task ExactBalanceCanBeHeldWithoutDebitsAndCannotBeHeldTwice()
    {
        using var db = new Database();
        await db.Credit(60.01m);
        await db.Credit(40.02m, promotional: true);
        var id = await db.Hold(100.03m);
        var hold = await db.Context.WalletHolds.Include(h => h.Allocations).SingleAsync(h => h.Id == id);
        Assert.Equal(hold.Amount, hold.Allocations.Sum(a => a.Amount));
        Assert.Equal(2, hold.Allocations.Count);
        Assert.Equal(2, await db.Context.WalletEntries.CountAsync());
        Assert.DoesNotContain(await db.Context.WalletEntries.ToListAsync(), e => e.Direction == WalletEntryDirection.Debit);
        var balance = await db.Balance();
        Assert.Equal(0m, balance.Balance);
        Assert.Equal(0m, balance.WithdrawableBalance);
        Assert.Equal(0m, balance.NonWithdrawableBalance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(0.01m));
        Assert.Single(await db.Context.WalletHolds.ToListAsync());
    }

    [Fact]
    public async Task AllocationUsesNonWithdrawableThenEarliestExpiryThenNullThenCash()
    {
        using var db = new Database();
        var cash = await db.Credit(50);
        var noExpiry = await db.Credit(30, promotional: true);
        var later = await db.Credit(20, promotional: true, expiry: Now.AddDays(2));
        var earlier = await db.Credit(10, promotional: true, expiry: Now.AddDays(1));
        var hold1 = await db.Hold(15);
        var first = await db.Context.WalletHoldAllocations.Where(a => a.WalletHoldId == hold1).ToListAsync();
        Assert.Equal(10, first.Single(a => a.WalletLotId == earlier).Amount);
        Assert.Equal(5, first.Single(a => a.WalletLotId == later).Amount);
        var hold2 = await db.Hold(50);
        var second = await db.Context.WalletHoldAllocations.Where(a => a.WalletHoldId == hold2).ToListAsync();
        Assert.Equal(15, second.Single(a => a.WalletLotId == later).Amount);
        Assert.Equal(30, second.Single(a => a.WalletLotId == noExpiry).Amount);
        Assert.Equal(5, second.Single(a => a.WalletLotId == cash).Amount);
        Assert.Equal(45, (await db.Balance()).WithdrawableBalance);
        Assert.Equal(0, (await db.Balance()).NonWithdrawableBalance);
    }

    [Fact]
    public async Task TiedLotsUseStableIdAndCashDoesNotGainAnExtraExpiryPriority()
    {
        using var db = new Database();
        await db.Credit(1, currency: "USD");
        var account = new WalletAccount { UserId = 1, Currency = "IRR" };
        var first = new WalletLot { WalletAccount = account, SourceType = WalletSourceType.PromotionalCredit };
        var second = new WalletLot { WalletAccount = account, SourceType = WalletSourceType.PromotionalCredit };
        db.Context.WalletEntries.AddRange(new WalletEntry { WalletAccount = account, WalletLot = first, Amount = 10 },
            new WalletEntry { WalletAccount = account, WalletLot = second, Amount = 10 });
        await db.Context.SaveChangesAsync();
        Assert.Equal(first.CreatedAtUtc, second.CreatedAtUtc);
        var hold = await db.Hold(5);
        Assert.Equal(Math.Min(first.Id, second.Id), (await db.Context.WalletHoldAllocations.SingleAsync(a => a.WalletHoldId == hold)).WalletLotId);
        await db.Service.ReleaseHoldAsync(1, "IRR", hold);
        var cashEarlierCreated = await db.Credit(10, expiry: Now.AddDays(2));
        await db.Credit(10, expiry: Now.AddDays(1));
        var allPromotionalPlusCash = await db.Hold(25);
        Assert.Equal(5, (await db.Context.WalletHoldAllocations.SingleAsync(a => a.WalletHoldId == allPromotionalPlusCash &&
            a.WalletLotId == cashEarlierCreated)).Amount);
    }

    [Fact]
    public async Task HoldReducesOnlyAllocatedBucketsAndNeverMixesUsersOrCurrencies()
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Credit(40, promotional: true);
        await db.Credit(500, userId: 2);
        await db.Credit(300, currency: "USD");
        await db.Hold(55);
        var balance = await db.Balance();
        Assert.Equal(85, balance.Balance);
        Assert.Equal(85, balance.WithdrawableBalance);
        Assert.Equal(0, balance.NonWithdrawableBalance);
        Assert.Equal(500, (await db.Service.GetBalanceAsync(2, "IRR")).Balance);
        Assert.Equal(300, (await db.Service.GetBalanceAsync(1, "USD")).Balance);
    }

    [Fact]
    public async Task ExpiredLotCannotFundNewHoldButExistingHoldCanConsumeIt()
    {
        using var db = new Database();
        var lot = await db.Credit(100, promotional: true, expiry: Now.AddMinutes(2));
        var hold = await db.Hold(60);
        db.Clock.UtcNow = Now.AddMinutes(3);
        Assert.Equal(0, (await db.Balance()).Balance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(1));
        await db.Service.ConsumeHoldAsync(1, "IRR", hold);
        var debit = await db.Context.WalletEntries.SingleAsync(e => e.Direction == WalletEntryDirection.Debit);
        Assert.Equal(lot, debit.WalletLotId);
        Assert.Equal(60, debit.Amount);
        Assert.Equal(WalletHoldStatus.Consumed, (await db.Context.WalletHolds.SingleAsync()).Status);
    }

    [Fact]
    public async Task ConsumeCreatesExactlyOneDebitPerOriginalAllocationAndCannotRepeat()
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Credit(40, promotional: true);
        var id = await db.Hold(60);
        var allocations = await db.Context.WalletHoldAllocations.AsNoTracking().ToListAsync();
        await db.Service.ConsumeHoldAsync(1, "IRR", id);
        var debits = await db.Context.WalletEntries.Where(e => e.Direction == WalletEntryDirection.Debit).ToListAsync();
        Assert.Equal(allocations.Count, debits.Count);
        foreach (var allocation in allocations)
            Assert.Single(debits, e => e.WalletLotId == allocation.WalletLotId && e.WalletAccountId == allocation.WalletAccountId && e.Amount == allocation.Amount);
        var hold = await db.Context.WalletHolds.SingleAsync();
        Assert.Equal(WalletHoldStatus.Consumed, hold.Status);
        Assert.Equal(Now, hold.ConsumedAtUtc);
        Assert.Equal(80, (await db.Balance()).Balance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ConsumeHoldAsync(1, "IRR", id));
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ReleaseHoldAsync(1, "IRR", id));
        Assert.Equal(2, await db.Context.WalletHoldAllocations.CountAsync());
        Assert.Equal(2, await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Debit));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReleaseRestoresAvailabilityOnlyWhileSourceLotIsValid(bool lotExpired)
    {
        using var db = new Database();
        await db.Credit(100, expiry: Now.AddMinutes(2));
        var id = await db.Hold(60);
        if (lotExpired) db.Clock.UtcNow = Now.AddMinutes(3);
        await db.Service.ReleaseHoldAsync(1, "IRR", id);
        await db.Service.ReleaseHoldAsync(1, "IRR", id);
        Assert.Equal(WalletHoldStatus.Released, (await db.Context.WalletHolds.SingleAsync()).Status);
        Assert.Equal(lotExpired ? 0m : 100m, (await db.Balance()).Balance);
        Assert.Single(await db.Context.WalletEntries.ToListAsync());
        Assert.Single(await db.Context.WalletHoldAllocations.ToListAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ConsumeHoldAsync(1, "IRR", id));
    }

    [Fact]
    public async Task DeadlineStopsReservationWithoutReadMutationAndCleanupPreservesHistory()
    {
        using var db = new Database();
        await db.Credit(100);
        var id = await db.Hold(60);
        db.Clock.UtcNow = Now.AddMinutes(10);
        Assert.Equal(100, (await db.Balance()).Balance);
        Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.SingleAsync()).Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ConsumeHoldAsync(1, "IRR", id));
        Assert.Equal(1, await db.Service.ExpireHoldsAsync(1, "IRR"));
        Assert.Equal(0, await db.Service.ExpireHoldsAsync(1, "IRR"));
        Assert.Equal(WalletHoldStatus.Expired, (await db.Context.WalletHolds.SingleAsync()).Status);
        Assert.Single(await db.Context.WalletHoldAllocations.ToListAsync());
        Assert.Single(await db.Context.WalletEntries.ToListAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ConsumeHoldAsync(1, "IRR", id));
    }

    [Fact]
    public async Task MixedStatesAndExpiryProduceExactAvailableBalance()
    {
        using var db = new Database();
        await db.Credit(200);
        await db.Credit(60, promotional: true, expiry: Now.AddMinutes(2));
        var consume = await db.Hold(20);
        await db.Service.ConsumeHoldAsync(1, "IRR", consume);
        var release = await db.Hold(20);
        await db.Service.ReleaseHoldAsync(1, "IRR", release);
        await db.Hold(30); // Protected promotional allocation; it outlives its lot.
        db.Clock.UtcNow = Now.AddMinutes(3);
        await db.Hold(50); // Only cash is now eligible.
        var balance = await db.Balance();
        Assert.Equal(150, balance.Balance);
        Assert.Equal(150, balance.WithdrawableBalance);
        Assert.Equal(0, balance.NonWithdrawableBalance);
        Assert.Equal(4, await db.Context.WalletHolds.CountAsync());
        Assert.Equal(3, await db.Context.WalletEntries.CountAsync());
    }

    [Fact]
    public async Task CrossAccountAllocationAndCrossUserOperationsAreRejected()
    {
        using var db = new Database();
        await db.Credit(100);
        var otherLot = await db.Credit(100, userId: 2);
        var id = await db.Hold(10);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => db.Service.ConsumeHoldAsync(2, "IRR", id));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => db.Service.ReleaseHoldAsync(2, "IRR", id));
        var account = await db.Context.WalletAccounts.SingleAsync(a => a.UserId == 1);
        var forged = new WalletHold { WalletAccountId = account.Id, Amount = 10, ExpiresAtUtc = Now.AddMinutes(10) };
        forged.Allocations.Add(new WalletHoldAllocation { WalletHold = forged, WalletAccountId = account.Id, WalletLotId = otherLot, Amount = 10 });
        db.Context.WalletHolds.Add(forged);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData("amount")]
    [InlineData("deadline")]
    [InlineData("account")]
    [InlineData("delete")]
    [InlineData("soft-delete")]
    public async Task HoldHistoryCannotBeRewritten(string change)
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Hold(20);
        db.Context.ChangeTracker.Clear();
        var hold = await db.Context.WalletHolds.SingleAsync();
        switch (change)
        {
            case "amount": hold.Amount = 21; break;
            case "deadline": hold.ExpiresAtUtc = Now.AddHours(1); break;
            case "account": hold.WalletAccountId++; break;
            case "delete": db.Context.Remove(hold); break;
            case "soft-delete": hold.IsDeleted = true; break;
        }
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AllocationCannotBeModifiedOrDeleted(bool delete)
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Hold(20);
        var allocation = await db.Context.WalletHoldAllocations.SingleAsync();
        if (delete) db.Context.Remove(allocation); else allocation.Amount = 21;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task InvalidTransitionsAndConsumeWithoutDebitsAreRejected()
    {
        using var db = new Database();
        await db.Credit(100);
        var id = await db.Hold(20);
        var hold = await db.Context.WalletHolds.Include(h => h.Allocations).SingleAsync();
        hold.Status = WalletHoldStatus.Consumed;
        hold.ConsumedAtUtc = Now;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
        db.Context.ChangeTracker.Clear();
        await db.Service.ReleaseHoldAsync(1, "IRR", id);
        hold = await db.Context.WalletHolds.SingleAsync();
        hold.Status = WalletHoldStatus.Active;
        hold.ReleasedAtUtc = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CallerTransactionOwnsHoldAndConsumeCommitOrRollback(bool commit)
    {
        using var db = new Database();
        await db.Credit(100);
        await using (var transaction = await db.Context.Database.BeginTransactionAsync())
        {
            (await db.Context.Users.SingleAsync(u => u.Id == 1)).LastName = "Caller pending update";
            var hold = await db.Hold(60);
            await db.Service.ConsumeHoldAsync(1, "IRR", hold);
            Assert.Same(transaction, db.Context.Database.CurrentTransaction);
            Assert.Equal(40, (await db.Balance()).Balance);
            if (commit) await transaction.CommitAsync(); else await transaction.RollbackAsync();
        }
        db.Context.ChangeTracker.Clear();
        Assert.Equal(commit ? 1 : 0, await db.Context.WalletHolds.CountAsync());
        Assert.Equal(commit ? 1 : 0, await db.Context.WalletHoldAllocations.CountAsync());
        Assert.Equal(commit ? 2 : 1, await db.Context.WalletEntries.CountAsync());
        Assert.Equal(commit ? 40m : 100m, (await db.Balance()).Balance);
        Assert.Equal(commit ? "Caller pending update" : "", (await db.Context.Users.SingleAsync(u => u.Id == 1)).LastName);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailureBeforeCommitRollsBackAllHoldWrites(bool consume)
    {
        using var db = new Database();
        await db.Credit(100);
        var hold = consume ? await db.Hold(60) : 0;
        db.Failure.Enabled = true;
        if (consume) await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ConsumeHoldAsync(1, "IRR", hold));
        else await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(60));
        db.Failure.Enabled = false;
        db.Context.ChangeTracker.Clear();
        Assert.Single(await db.Context.WalletEntries.ToListAsync());
        Assert.Equal(consume ? 1 : 0, await db.Context.WalletHolds.CountAsync());
        if (consume) Assert.Equal(WalletHoldStatus.Active, (await db.Context.WalletHolds.SingleAsync()).Status);
        Assert.Equal(consume ? 40m : 100m, (await db.Balance()).Balance);
    }

    [Fact]
    public async Task CompetingHoldsUseDatabaseSerializationAndCannotOverspend()
    {
        using var db = new Database();
        await db.Credit(100);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt() => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            var service = new WalletService(context, db.Clock);
            gate.Wait();
            try { await service.CreateHoldAsync(1, "IRR", 60, Now.AddMinutes(10)); return true; }
            catch (InvalidOperationException error) when (error.Message.Contains("Insufficient")) { return false; }
        });
        var first = Attempt(); var second = Attempt(); gate.Set();
        var results = await Task.WhenAll(first, second);
        Assert.Single(results, success => success);
        Assert.Single(await db.Context.WalletHolds.ToListAsync());
        Assert.Equal(40, (await db.Balance()).Balance);
    }

    [Fact]
    public async Task ConcurrentConsumersCreateOnlyOneSetOfDebits()
    {
        using var db = new Database();
        await db.Credit(100);
        var id = await db.Hold(60);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt() => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            var service = new WalletService(context, db.Clock);
            // Both callers may have tracked an Active hold before obtaining the account lock.
            await context.WalletHolds.SingleAsync(h => h.Id == id);
            gate.Wait();
            try { await service.ConsumeHoldAsync(1, "IRR", id); return true; }
            catch (InvalidOperationException error) when (error.Message.Contains("active, unexpired")) { return false; }
        });
        var first = Attempt(); var second = Attempt(); gate.Set();
        Assert.Single(await Task.WhenAll(first, second), success => success);
        Assert.Single(await db.Context.WalletEntries.Where(e => e.Direction == WalletEntryDirection.Debit).ToListAsync());
        Assert.Equal(40, (await db.Balance()).Balance);
    }

    [Fact]
    public void SqlServerHoldModelUsesNoActionCompositeOwnershipAndStatusConcurrency()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        var hold = model.FindEntityType(typeof(WalletHold))!;
        Assert.True(hold.FindProperty(nameof(WalletHold.Status))!.IsConcurrencyToken);
        Assert.Equal(18, hold.FindProperty(nameof(WalletHold.Amount))!.GetPrecision());
        Assert.Equal(2, hold.FindProperty(nameof(WalletHold.Amount))!.GetScale());
        Assert.False(hold.FindProperty(nameof(WalletHold.ExpiresAtUtc))!.IsNullable);
        var allocation = model.FindEntityType(typeof(WalletHoldAllocation))!;
        Assert.Equal(2, allocation.GetForeignKeys().Count());
        Assert.All(allocation.GetForeignKeys(), fk =>
        {
            Assert.Equal(2, fk.Properties.Count);
            Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior);
        });
        Assert.All(hold.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        Assert.Contains(allocation.GetIndexes(), i => i.IsUnique && i.Properties.Select(p => p.Name)
            .SequenceEqual(new[] { "WalletHoldId", "WalletLotId" }));
    }

    private sealed class Clock : TimeProvider
    {
        public DateTime UtcNow { get; set; } = Now;
        public override DateTimeOffset GetUtcNow() => new(UtcNow);
    }
    private sealed class FailAfterSave : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default) => Enabled
            ? throw new InvalidOperationException("Failure before commit") : ValueTask.FromResult(result);
    }
    private sealed class Database : IDisposable
    {
        private readonly string path = Path.GetTempFileName();
        public TestContext Context { get; }
        public Clock Clock { get; } = new();
        public FailAfterSave Failure { get; } = new();
        public WalletService Service => new(Context, Clock);
        public Database()
        {
            Context = NewContext();
            Context.Database.EnsureCreated();
            Context.Users.AddRange(new User { Id = 1 }, new User { Id = 2 });
            Context.SaveChanges();
        }
        public TestContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=15").AddInterceptors(Failure).Options);
        public Task<int> Credit(decimal amount, bool promotional = false, DateTime? expiry = null, string currency = "IRR", int userId = 1) =>
            Service.CreateCreditAsync(new(userId, currency, amount,
                promotional ? WalletSourceType.PromotionalCredit : WalletSourceType.CashReceived, expiry));
        public Task<int> Hold(decimal amount) => Service.CreateHoldAsync(1, "IRR", amount, Now.AddMinutes(10));
        public Task<Kooch.Api.Dtos.Wallet.WalletBalanceResponse> Balance() => Service.GetBalanceAsync(1, "IRR");
        public void Dispose() { Context.Dispose(); File.Delete(path); }
    }
    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<WalletAccount>().Property(a => a.RowVersion).ValueGeneratedNever();
        }
    }
}
