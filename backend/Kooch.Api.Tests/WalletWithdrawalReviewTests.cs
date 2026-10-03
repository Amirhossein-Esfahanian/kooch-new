using System.Reflection;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletWithdrawalReviewTests
{
    private static readonly DateTime Now = new(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AdminEndpointsRequireManagePayments()
    {
        var controller = typeof(AdminWalletWithdrawalsController);
        Assert.NotNull(controller.GetCustomAttribute<AdminAuthorizeAttribute>());
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ManagePayments).Policy,
            controller.GetCustomAttribute<PermissionAuthorizeAttribute>()!.Policy);
    }

    [Fact]
    public async Task ManagePaymentsAllowsOnlyAuthorizedAdminAssistant()
    {
        using var db = new Database();
        var withoutPermission = await db.Context.Users.SingleAsync(user => user.Id == 2);
        var withPermission = await db.Context.Users.SingleAsync(user => user.Id == 3);
        withoutPermission.Role = UserRole.AdminAssistant;
        withPermission.Role = UserRole.AdminAssistant;
        db.Context.Permissions.Add(new Permission
        {
            Key = PermissionKey.ManagePayments, Name = nameof(PermissionKey.ManagePayments)
        });
        db.Context.UserPermissions.Add(new UserPermission
        {
            UserId = 3, PermissionKey = PermissionKey.ManagePayments, IsAllowed = true
        });
        await db.Context.SaveChangesAsync();
        var permissions = new PermissionService(db.Context, new PropertyAccessService(db.Context));
        Assert.False(await permissions.HasPermissionAsync(2, PermissionKey.ManagePayments));
        Assert.True(await permissions.HasPermissionAsync(3, PermissionKey.ManagePayments));
    }

    [Fact]
    public async Task AdminCanListAndReadPendingWithoutSourceIds()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(20);
        var list = await db.Service.ListAdminWithdrawalsAsync(status: WalletWithdrawalStatus.Pending);
        var item = Assert.Single(list.Items);
        Assert.Equal(created.Id, item.Id);
        Assert.Equal("First Guest", item.GuestName);
        Assert.Null(item.ProcessedAtUtc);
        Assert.Equal(item, await db.Service.GetAdminWithdrawalAsync(created.Id));
        var json = System.Text.Json.JsonSerializer.Serialize(item);
        Assert.DoesNotContain("WalletAccountId", json);
        Assert.DoesNotContain("WalletLotId", json);
        Assert.DoesNotContain("AllocationId", json);
    }

    [Fact]
    public async Task ApproveKeepsFundsReservedAndCreatesNoDebit()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(60);
        var entryCount = await db.Context.WalletEntries.CountAsync();
        var approved = await db.Service.ApproveWithdrawalAsync(created.Id, 3);
        Assert.Equal(WalletWithdrawalStatus.Approved, approved.Status);
        Assert.NotNull(approved.ProcessedAtUtc);
        Assert.Equal(3, (await db.Context.WalletWithdrawalRequests.SingleAsync()).UpdatedByUserId);
        Assert.Equal(40, (await db.Balance()).WithdrawableBalance);
        Assert.Equal(entryCount, await db.Context.WalletEntries.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(41));
        Assert.Equal(WalletWithdrawalStatus.Approved,
            Assert.Single((await db.Service.ListWithdrawalsAsync(1)).Items).Status);
    }

    [Fact]
    public async Task RejectReleasesValidFundsWithoutDeletingAllocationsOrDebiting()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(60);
        var entryCount = await db.Context.WalletEntries.CountAsync();
        var rejected = await db.Service.RejectWithdrawalAsync(created.Id, 3);
        Assert.Equal(WalletWithdrawalStatus.Rejected, rejected.Status);
        Assert.NotNull(rejected.ProcessedAtUtc);
        Assert.Single(await db.Context.WalletWithdrawalAllocations.ToListAsync());
        Assert.Equal(100, (await db.Balance()).WithdrawableBalance);
        Assert.Equal(entryCount, await db.Context.WalletEntries.CountAsync());
        await db.Hold(100);
        Assert.Equal(WalletWithdrawalStatus.Rejected,
            Assert.Single((await db.Service.ListWithdrawalsAsync(1)).Items).Status);
    }

    [Fact]
    public async Task RejectionNeverRevivesExpiredSourceLot()
    {
        using var db = new Database();
        await db.Credit(100, Now.AddHours(1));
        var created = await db.Withdraw(60);
        db.Clock.UtcNow = Now.AddHours(2);
        await db.Service.RejectWithdrawalAsync(created.Id, 3);
        Assert.Equal(0, (await db.Balance()).Balance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Hold(1));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DuplicateReviewAndOppositeTransitionAreRejected(bool approveFirst)
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(20);
        if (approveFirst)
        {
            await db.Service.ApproveWithdrawalAsync(created.Id, 3);
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ApproveWithdrawalAsync(created.Id, 3));
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.RejectWithdrawalAsync(created.Id, 3));
        }
        else
        {
            await db.Service.RejectWithdrawalAsync(created.Id, 3);
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.RejectWithdrawalAsync(created.Id, 3));
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.ApproveWithdrawalAsync(created.Id, 3));
        }
        Assert.Single(await db.Context.WalletWithdrawalAllocations.ToListAsync());
    }

    [Fact]
    public async Task ApproveRejectRaceHasOneWinner()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(20);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt(bool approve) => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            var service = new WalletService(context, db.Clock);
            gate.Wait();
            try
            {
                if (approve) await service.ApproveWithdrawalAsync(created.Id, 3);
                else await service.RejectWithdrawalAsync(created.Id, 3);
                return true;
            }
            catch (Exception error) when (error is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
            {
                return false;
            }
        });
        var approve = Attempt(true); var reject = Attempt(false); gate.Set();
        Assert.Single(await Task.WhenAll(approve, reject), result => result);
        var status = (await db.Context.WalletWithdrawalRequests.AsNoTracking().SingleAsync()).Status;
        Assert.True(status is WalletWithdrawalStatus.Approved or WalletWithdrawalStatus.Rejected);
        Assert.Equal(status == WalletWithdrawalStatus.Approved ? 80 : 100,
            (await db.Balance()).WithdrawableBalance);
    }

    [Fact]
    public async Task TwoApprovalsCannotBothCommit()
    {
        using var db = new Database();
        await db.Credit(100);
        var created = await db.Withdraw(20);
        using var gate = new ManualResetEventSlim();
        Task<bool> Attempt() => Task.Run(async () =>
        {
            await using var context = db.NewContext();
            gate.Wait();
            try
            {
                await new WalletService(context, db.Clock).ApproveWithdrawalAsync(created.Id, 3);
                return true;
            }
            catch (Exception error) when (error is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
            {
                return false;
            }
        });
        var first = Attempt(); var second = Attempt(); gate.Set();
        Assert.Single(await Task.WhenAll(first, second), result => result);
        Assert.Equal(WalletWithdrawalStatus.Approved,
            (await db.Context.WalletWithdrawalRequests.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task ReviewCannotRewriteOriginalFactsOrReassignWallet()
    {
        using var db = new Database();
        await db.Credit(100);
        await db.Credit(100, userId: 2);
        var created = await db.Withdraw(20);
        var request = await db.Context.WalletWithdrawalRequests.SingleAsync(item => item.Id == created.Id);
        request.Amount = 21;
        request.Status = WalletWithdrawalStatus.Approved;
        request.UpdatedByUserId = 3;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
        db.Context.ChangeTracker.Clear();
        request = await db.Context.WalletWithdrawalRequests.SingleAsync(item => item.Id == created.Id);
        var otherAccountId = await db.Context.WalletAccounts.Where(account => account.UserId == 2)
            .Select(account => account.Id).SingleAsync();
        request.WalletAccountId = otherAccountId;
        request.Status = WalletWithdrawalStatus.Approved;
        request.UpdatedByUserId = 3;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
        db.Context.ChangeTracker.Clear();
        var allocation = await db.Context.WalletWithdrawalAllocations.SingleAsync();
        allocation.WalletLotId = await db.Context.WalletLots.Where(lot => lot.WalletAccount.UserId == 2)
            .Select(lot => lot.Id).SingleAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

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
            Context.Users.AddRange(new User { Id = 1, FirstName = "First", LastName = "Guest" },
                new User { Id = 2 }, new User { Id = 3 });
            Context.SaveChanges();
        }
        public TestContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=15")
            .AddInterceptors(SqliteTestFunctions.LenInterceptor).Options);
        public Task<int> Credit(decimal amount, DateTime? expiry = null, int userId = 1) =>
            Service.CreateCreditAsync(new(userId, "IRR", amount, WalletSourceType.CashReceived, expiry));
        public Task<int> Hold(decimal amount) => Service.CreateHoldAsync(1, "IRR", amount, Clock.UtcNow.AddMinutes(10));
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
            builder.Entity<WalletAccount>().Property(account => account.RowVersion).ValueGeneratedNever();
        }
    }
}
