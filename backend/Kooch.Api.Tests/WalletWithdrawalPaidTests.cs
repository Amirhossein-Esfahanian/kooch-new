using System.Reflection;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services.Wallet;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletWithdrawalPaidTests
{
    private static readonly DateTime Now = new(2026, 10, 3, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void PaidRouteUsesExistingAdminPaymentPermissionAndSafePayload()
    {
        var type = typeof(AdminWalletWithdrawalsController);
        Assert.NotNull(type.GetCustomAttribute<AdminAuthorizeAttribute>());
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ManagePayments).Policy,
            type.GetCustomAttribute<PermissionAuthorizeAttribute>()!.Policy);
        var method = type.GetMethod(nameof(AdminWalletWithdrawalsController.Paid))!;
        Assert.Equal("{id:int}/paid", method.GetCustomAttribute<HttpPutAttribute>()!.Template);
        Assert.Equal(new[] { "PayoutMethod", "ReferenceNumber", "PaidAtUtc", "Note" }.Order(),
            typeof(MarkWalletWithdrawalPaidRequest).GetProperties().Select(property => property.Name).Order());
    }

    [Fact]
    public void MigrationAddsOnlyPayoutFactsAndUniqueAccountSafeDebitLinkage()
    {
        var operations = new AddWalletWithdrawalPayoutExecution().UpOperations;
        Assert.All(operations, operation => Assert.True(operation is AddColumnOperation or AddUniqueConstraintOperation or
            CreateIndexOperation or AddCheckConstraintOperation or AddForeignKeyOperation));
        Assert.All(operations.OfType<AddForeignKeyOperation>(),
            foreignKey => Assert.Equal(ReferentialAction.NoAction, foreignKey.OnDelete));
        Assert.Contains(operations.OfType<CreateIndexOperation>(), index =>
            index.Table == "WalletEntries" && index.Columns.SequenceEqual(new[] { "WalletWithdrawalAllocationId" }) &&
            index.IsUnique && index.Filter == "[WalletWithdrawalAllocationId] IS NOT NULL");
        Assert.Contains(operations.OfType<AddForeignKeyOperation>(), fk =>
            fk.Table == "WalletEntries" && fk.Columns.SequenceEqual(new[]
                { "WalletWithdrawalAllocationId", "WalletAccountId", "WalletLotId" }));
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        Assert.Contains(model.FindEntityType(typeof(WalletEntry))!.GetIndexes(), index =>
            index.IsUnique && index.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(WalletEntry.WalletWithdrawalAllocationId) }));
    }

    [Fact]
    public async Task ApprovedPaidCreatesOneExactDebitPerOriginalAllocationAndRecordsFacts()
    {
        using var db = new Database();
        await db.Credit(30, Now.AddDays(1));
        await db.Credit(70);
        var created = await db.Withdraw(80);
        await db.Approve(created.Id);
        var before = await db.Balance();
        var lotCount = await db.Context.WalletLots.CountAsync();
        var result = await db.Pay(created.Id);
        Assert.Equal(WalletWithdrawalStatus.Paid, result.Status);
        Assert.Equal(Now, result.PaidAtUtc);
        Assert.Equal(SettlementPaymentMethod.BankTransfer, result.PayoutMethod);
        Assert.Equal("PAY-123", result.PayoutReferenceNumber);
        Assert.Equal("Completed", result.PayoutNote);
        var request = await db.Context.WalletWithdrawalRequests.Include(item => item.Allocations)
            .SingleAsync(item => item.Id == created.Id);
        Assert.Equal(3, request.PaidByUserId);
        var debits = await db.Context.WalletEntries.Where(entry => entry.Direction == WalletEntryDirection.Debit)
            .ToListAsync();
        Assert.Equal(request.Allocations.Count, debits.Count);
        Assert.Equal(request.Amount, debits.Sum(entry => entry.Amount));
        Assert.All(request.Allocations, allocation =>
        {
            var debit = Assert.Single(debits, entry => entry.WalletWithdrawalAllocationId == allocation.Id);
            Assert.Equal(allocation.WalletAccountId, debit.WalletAccountId);
            Assert.Equal(allocation.WalletLotId, debit.WalletLotId);
            Assert.Equal(allocation.Amount, debit.Amount);
        });
        Assert.Equal(lotCount, await db.Context.WalletLots.CountAsync());
        Assert.Equal(before, await db.Balance());
        Assert.Equal(0, await db.Context.Payments.CountAsync());
        Assert.Equal(0, await db.Context.RefundRecords.CountAsync());
        Assert.Equal(0, await db.Context.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task ExpiredReservedLotCanStillBePaidWithoutReallocating()
    {
        using var db = new Database();
        var lot = await db.Credit(100, Now.AddHours(1));
        var created = await db.Withdraw(60);
        await db.Approve(created.Id);
        db.Clock.UtcNow = Now.AddHours(2);
        await db.Pay(created.Id);
        var debit = Assert.Single(await db.Context.WalletEntries.Where(entry =>
            entry.Direction == WalletEntryDirection.Debit).ToListAsync());
        Assert.Equal(lot, debit.WalletLotId);
        Assert.Equal(60, debit.Amount);
        Assert.Equal(0, (await db.Balance()).Balance);
    }

    [Theory]
    [InlineData(WalletWithdrawalStatus.Pending)]
    [InlineData(WalletWithdrawalStatus.Rejected)]
    [InlineData(WalletWithdrawalStatus.Cancelled)]
    public async Task OnlyApprovedCanBePaid(WalletWithdrawalStatus status)
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(20);
        if (status == WalletWithdrawalStatus.Rejected)
            await db.Service.RejectWithdrawalAsync(created.Id, 3);
        else if (status == WalletWithdrawalStatus.Cancelled)
            await db.Context.WalletWithdrawalRequests.Where(request => request.Id == created.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(request => request.Status, status));
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Pay(created.Id));
        Assert.Empty(await db.Context.WalletEntries.Where(entry => entry.Direction == WalletEntryDirection.Debit)
            .ToListAsync());
    }

    [Fact]
    public async Task PaidReplayDoesNotCreateDuplicateDebits()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        await db.Pay(created.Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Pay(created.Id));
        Assert.Single(await db.Context.WalletEntries.Where(entry => entry.Direction == WalletEntryDirection.Debit)
            .ToListAsync());
    }

    [Fact]
    public async Task ExecutionFactsAndDebitLinkageCannotBeRewritten()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        await db.Pay(created.Id);
        var request = await db.Context.WalletWithdrawalRequests.SingleAsync(item => item.Id == created.Id);
        request.PayoutReferenceNumber = "REWRITTEN";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
        db.Context.ChangeTracker.Clear();
        var debit = await db.Context.WalletEntries.SingleAsync(entry => entry.Direction == WalletEntryDirection.Debit);
        debit.WalletWithdrawalAllocationId = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task LinkedDebitWithoutPaidTransitionIsRejected()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        var allocation = await db.Context.WalletWithdrawalAllocations.SingleAsync();
        db.Context.WalletEntries.Add(new WalletEntry
        {
            WalletWithdrawalAllocation = allocation, WalletWithdrawalAllocationId = allocation.Id,
            WalletAccountId = allocation.WalletAccountId, WalletLotId = allocation.WalletLotId,
            Amount = allocation.Amount, Direction = WalletEntryDirection.Debit, CreatedByUserId = 3
        });
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task CallerTransactionRollbackRemovesDebitAndPaidFactsTogether()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        await using (var context = db.NewContext())
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            var service = new WalletService(context, db.Clock);
            await service.PayWithdrawalAsync(created.Id, 3, Payment());
            await transaction.RollbackAsync();
        }
        await using var fresh = db.NewContext();
        var request = await fresh.WalletWithdrawalRequests.SingleAsync(item => item.Id == created.Id);
        Assert.Equal(WalletWithdrawalStatus.Approved, request.Status);
        Assert.Null(request.PaidAtUtc);
        Assert.Empty(await fresh.WalletEntries.Where(entry => entry.Direction == WalletEntryDirection.Debit)
            .ToListAsync());
    }

    [Fact]
    public async Task ConcurrentPaidAttemptsProduceOneDebitSet()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt() => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            gate.Wait();
            try
            {
                await new WalletService(context, db.Clock).PayWithdrawalAsync(created.Id, 3, Payment());
                return true;
            }
            catch (Exception error) when (error is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
            {
                return false;
            }
        });
        var first = Attempt(); var second = Attempt(); gate.Set();
        Assert.Single(await Task.WhenAll(first, second), result => result);
        Assert.Single(await db.Context.WalletEntries.AsNoTracking().Where(entry =>
            entry.Direction == WalletEntryDirection.Debit).ToListAsync());
    }

    [Fact]
    public async Task GuestReadShowsPaidWhileAdminReadShowsOnlySafePayoutFacts()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(40);
        await db.Approve(created.Id);
        await db.Pay(created.Id);
        Assert.Equal(WalletWithdrawalStatus.Paid,
            Assert.Single((await db.Service.ListWithdrawalsAsync(1)).Items).Status);
        var admin = await db.Service.GetAdminWithdrawalAsync(created.Id);
        Assert.Equal("PAY-123", admin.PayoutReferenceNumber);
        var json = System.Text.Json.JsonSerializer.Serialize(admin);
        Assert.DoesNotContain("WalletEntryId", json);
        Assert.DoesNotContain("WalletLotId", json);
        Assert.DoesNotContain("WalletAccountId", json);
    }

    private static MarkWalletWithdrawalPaidRequest Payment() => new()
    {
        PayoutMethod = SettlementPaymentMethod.BankTransfer,
        ReferenceNumber = " PAY-123 ", PaidAtUtc = new DateTimeOffset(Now), Note = " Completed "
    };

    private sealed class Clock : TimeProvider
    {
        public DateTime UtcNow { get; set; } = Now;
        public override DateTimeOffset GetUtcNow() => new(UtcNow);
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
            Context.Users.AddRange(new User { Id = 1 }, new User { Id = 3 });
            Context.SaveChanges();
        }
        public TestContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=15").Options);
        public Task<int> Credit(decimal amount, DateTime? expiry = null) =>
            Service.CreateCreditAsync(new(1, "IRR", amount, WalletSourceType.CashReceived, expiry));
        public Task<WalletWithdrawalResponse> Withdraw(decimal amount) => Service.CreateWithdrawalAsync(1, "IRR", amount);
        public Task<AdminWalletWithdrawalResponse> Approve(int id) => Service.ApproveWithdrawalAsync(id, 3);
        public Task<AdminWalletWithdrawalResponse> Pay(int id) => Service.PayWithdrawalAsync(id, 3, Payment());
        public Task<WalletBalanceResponse> Balance() => Service.GetBalanceAsync(1, "IRR");
        public void Dispose() { Context.Dispose(); File.Delete(path); }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<WalletAccount>().Property(account => account.RowVersion).ValueGeneratedNever();
        }
    }
}
