using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletWithdrawalTests
{
    private static readonly DateTime Now = new(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void MigrationIsAdditiveAndUsesNoActionOwnership()
    {
        var operations = new AddWalletWithdrawalRequests().UpOperations;
        var tables = operations.OfType<CreateTableOperation>().ToArray();
        Assert.Equal(new[] { "WalletWithdrawalAllocations", "WalletWithdrawalRequests" },
            tables.Select(table => table.Name).Order().ToArray());
        Assert.All(operations, operation => Assert.True(operation is CreateTableOperation or CreateIndexOperation));
        Assert.All(tables.SelectMany(table => table.ForeignKeys),
            foreignKey => Assert.Equal(ReferentialAction.NoAction, foreignKey.OnDelete));
        var allocations = Assert.Single(tables, table => table.Name == "WalletWithdrawalAllocations");
        Assert.Contains(allocations.ForeignKeys, foreignKey =>
            foreignKey.Columns.SequenceEqual(new[] { "WalletLotId", "WalletAccountId" }));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("0.001")]
    public async Task InvalidAmountIsRejected(string value)
    {
        using var db = new Database();
        await db.Credit(100);
        await Assert.ThrowsAsync<ArgumentException>(() => db.Withdraw(decimal.Parse(value,
            System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Empty(await db.Context.WalletWithdrawalRequests.ToListAsync());
    }

    [Fact]
    public async Task PendingRequestReservesWithdrawableOnlyWithoutLedgerDebit()
    {
        using var db = new Database();
        var cash = await db.Credit(100);
        await db.Credit(40, promotional: true);
        var entryCount = await db.Context.WalletEntries.CountAsync();
        var response = await db.Withdraw(70);
        Assert.Equal(WalletWithdrawalStatus.Pending, response.Status);
        Assert.Equal(70, response.Amount);
        Assert.Equal("IRR", response.Currency);
        Assert.Single(await db.Context.WalletWithdrawalAllocations.ToListAsync(),
            allocation => allocation.WalletLotId == cash && allocation.Amount == 70);
        Assert.Equal(entryCount, await db.Context.WalletEntries.CountAsync());
        var balance = await db.Balance();
        Assert.Equal(70, balance.Balance);
        Assert.Equal(30, balance.WithdrawableBalance);
        Assert.Equal(40, balance.NonWithdrawableBalance);
    }

    [Fact]
    public async Task InsufficientOrNonWithdrawableFundsCannotCreatePartialRequest()
    {
        using var db = new Database();
        await db.Credit(100, promotional: true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Withdraw(1));
        await db.Credit(20);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Withdraw(21));
        Assert.Empty(await db.Context.WalletWithdrawalRequests.ToListAsync());
        Assert.Empty(await db.Context.WalletWithdrawalAllocations.ToListAsync());
    }

    [Fact]
    public async Task BookingHoldAndWithdrawalCannotReserveSameFundsInEitherOrder()
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Hold(60);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Withdraw(41));
        await db.Withdraw(40);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(1));
        Assert.Equal(0, (await db.Balance()).Balance);
    }

    [Fact]
    public async Task LotsAreAllocatedByExpiryThenCreatedDateThenIdAndExpiredLotsAreSkipped()
    {
        using var db = new Database();
        var noExpiry = await db.Credit(30);
        var later = await db.Credit(20, expiry: Now.AddDays(2));
        var earlier = await db.Credit(10, expiry: Now.AddDays(1));
        var response = await db.Withdraw(25);
        var allocations = await db.Context.WalletWithdrawalAllocations
            .Where(a => a.WalletWithdrawalRequestId == response.Id).ToDictionaryAsync(a => a.WalletLotId, a => a.Amount);
        Assert.Equal(10, allocations[earlier]);
        Assert.Equal(15, allocations[later]);
        Assert.False(allocations.ContainsKey(noExpiry));
    }

    [Fact]
    public async Task CurrentUserCannotWithdrawOrListAnotherUsersFunds()
    {
        using var db = new Database();
        await db.Credit(100, userId: 2);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Withdraw(1));
        var other = await db.Service.CreateWithdrawalAsync(2, "IRR", 30);
        Assert.Empty((await db.Service.ListWithdrawalsAsync(1)).Items);
        var listed = Assert.Single((await db.Service.ListWithdrawalsAsync(2)).Items);
        Assert.Equal(other.Id, listed.Id);
        Assert.DoesNotContain("WalletLotId", System.Text.Json.JsonSerializer.Serialize(listed));
        Assert.DoesNotContain("WalletAccountId", System.Text.Json.JsonSerializer.Serialize(listed));
    }

    [Fact]
    public async Task ListIsNewestFirstAndPaged()
    {
        using var db = new Database();
        await db.Credit(100);
        var first = await db.Withdraw(10);
        var second = await db.Withdraw(20);
        var page = await db.Service.ListWithdrawalsAsync(1, 1, 1);
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(2, page.TotalPages);
        Assert.Equal(second.Id, Assert.Single(page.Items).Id);
        Assert.Equal(first.Id, Assert.Single((await db.Service.ListWithdrawalsAsync(1, 2, 1)).Items).Id);
    }

    [Fact]
    public async Task CrossAccountSourceLotIsRejectedByCompositeForeignKey()
    {
        using var db = new Database();
        await db.Credit(100);
        var otherLot = await db.Credit(100, userId: 2);
        var account = await db.Context.WalletAccounts.SingleAsync(a => a.UserId == 1);
        var forged = new WalletWithdrawalRequest
        {
            WalletAccountId = account.Id, Amount = 10,
            Status = WalletWithdrawalStatus.Pending, RequestedAtUtc = Now
        };
        forged.Allocations.Add(new WalletWithdrawalAllocation
        {
            WalletWithdrawalRequest = forged, WalletAccountId = account.Id,
            WalletLotId = otherLot, Amount = 10
        });
        db.Context.WalletWithdrawalRequests.Add(forged);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task WithdrawalAndHoldCompetingAtSameTimeCannotOverspend()
    {
        using var db = new Database();
        await db.Credit(100);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt(bool withdrawal) => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            var service = new WalletService(context, db.Clock);
            gate.Wait();
            try
            {
                if (withdrawal) await service.CreateWithdrawalAsync(1, "IRR", 70);
                else await service.CreateHoldAsync(1, "IRR", 70, Now.AddMinutes(10));
                return true;
            }
            catch (Exception error) when (error is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
            {
                return false;
            }
        });
        var first = Attempt(true); var second = Attempt(false); gate.Set();
        Assert.Single(await Task.WhenAll(first, second), success => success);
        Assert.True((await db.Balance()).Balance is >= 0 and <= 30);
    }

    [Fact]
    public async Task TwoConcurrentWithdrawalsCannotOverspend()
    {
        using var db = new Database();
        await db.Credit(100);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt() => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            gate.Wait();
            try { await new WalletService(context, db.Clock).CreateWithdrawalAsync(1, "IRR", 70); return true; }
            catch (Exception error) when (error is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException) { return false; }
        });
        var first = Attempt(); var second = Attempt(); gate.Set();
        Assert.Single(await Task.WhenAll(first, second), success => success);
        Assert.Single(await db.Context.WalletWithdrawalRequests.ToListAsync());
    }

    [Fact]
    public async Task RequestAndAllocationCannotBeModifiedOrDeleted()
    {
        using var db = new Database();
        await db.Credit(100);
        var response = await db.Withdraw(20);
        var request = await db.Context.WalletWithdrawalRequests.SingleAsync(r => r.Id == response.Id);
        request.Amount = 21;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
        db.Context.Entry(request).State = EntityState.Unchanged;
        var allocation = await db.Context.WalletWithdrawalAllocations.SingleAsync();
        db.Context.WalletWithdrawalAllocations.Remove(allocation);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public void ModelHasAccountSafeLotFkAndImmutableAmounts()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        var request = model.FindEntityType(typeof(WalletWithdrawalRequest))!;
        var allocation = model.FindEntityType(typeof(WalletWithdrawalAllocation))!;
        Assert.Equal(18, request.FindProperty(nameof(WalletWithdrawalRequest.Amount))!.GetPrecision());
        Assert.Equal(2, request.FindProperty(nameof(WalletWithdrawalRequest.Amount))!.GetScale());
        Assert.All(request.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        Assert.All(allocation.GetForeignKeys(), fk =>
        {
            Assert.Equal(2, fk.Properties.Count);
            Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior);
        });
    }

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(Now);
    }

    private sealed class Database : IDisposable
    {
        private readonly string path = Path.GetTempFileName();
        public TestContext Context { get; }
        public Clock Clock { get; } = new();
        public WalletService Service => new(Context, Clock);
        public Database()
        {
            Context = NewContext();
            Context.Database.EnsureCreated();
            Context.Users.AddRange(new User { Id = 1 }, new User { Id = 2 });
            Context.SaveChanges();
        }
        public TestContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=15").Options);
        public Task<int> Credit(decimal amount, bool promotional = false, DateTime? expiry = null, int userId = 1) =>
            Service.CreateCreditAsync(new(userId, "IRR", amount,
                promotional ? WalletSourceType.PromotionalCredit : WalletSourceType.CashReceived, expiry));
        public Task<int> Hold(decimal amount) => Service.CreateHoldAsync(1, "IRR", amount, Now.AddMinutes(10));
        public Task<Kooch.Api.Dtos.Wallet.WalletWithdrawalResponse> Withdraw(decimal amount) =>
            Service.CreateWithdrawalAsync(1, "IRR", amount);
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
