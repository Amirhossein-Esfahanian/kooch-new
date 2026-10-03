using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletTransactionHistoryTests
{
    private static readonly DateTime Now = new(2026, 10, 3, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task AuthenticatedRouteUsesClaimsAndExposesOnlySafeLedgerFields()
    {
        using var db = new Database();
        await db.Credit(12.34m);
        await db.Credit(99m, userId: 2);
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, UserRole.Client.ToString())
        ], "test"));
        http.Request.QueryString = new QueryString("?userId=2&walletAccountId=2&walletLotId=2");
        var controller = new AccountWalletController(db.Service) { ControllerContext = new() { HttpContext = http } };
        var result = Assert.IsType<OkObjectResult>((await controller.ListTransactions()).Result);
        var page = Assert.IsType<PagedResult<WalletTransactionResponse>>(result.Value);
        var own = Assert.Single(page.Items);
        Assert.Equal(12.34m, own.Amount);
        Assert.Equal(WalletEntryDirection.Credit, own.Direction);
        Assert.Equal("IRR", own.Currency);
        Assert.True(own.Id > 0);
        Assert.True(own.CreatedAtUtc != default);
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(AccountWalletController), typeof(AuthorizeAttribute)));
        Assert.Equal("transactions", typeof(AccountWalletController).GetMethod(nameof(AccountWalletController.ListTransactions))!
            .GetCustomAttributes(typeof(HttpGetAttribute), false).Cast<HttpGetAttribute>().Single().Template);
        Assert.DoesNotContain(typeof(AccountWalletController).GetMethod(nameof(AccountWalletController.ListTransactions))!
            .GetParameters(), parameter => parameter.Name is "userId" or "walletAccountId" or "walletLotId");
        Assert.Equal(new[] { "Amount", "CreatedAtUtc", "Currency", "Direction", "Id" },
            typeof(WalletTransactionResponse).GetProperties().Select(property => property.Name).Order().ToArray());
        http.User = new ClaimsPrincipal(new ClaimsIdentity());
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.ListTransactions());
    }

    [Fact]
    public async Task CurrencyScopeAndMissingAccountReturnOnlyMatchingRowsOrEmptyPage()
    {
        using var db = new Database();
        await db.Credit(10m);
        await db.Credit(20m, currency: "USD");
        await db.Credit(30m, userId: 2);
        Assert.Equal(10m, Assert.Single((await db.Service.ListTransactionsAsync(1, " irr ")).Items).Amount);
        Assert.Equal("USD", Assert.Single((await db.Service.ListTransactionsAsync(1, "USD")).Items).Currency);
        var missing = await db.Service.ListTransactionsAsync(1, "EUR");
        Assert.Empty(missing.Items);
        Assert.Equal(0, missing.TotalCount);
        Assert.Equal(0, missing.TotalPages);
        Assert.False(await db.Context.WalletAccounts.AnyAsync(account => account.UserId == 1 && account.Currency == "EUR"));
    }

    [Fact]
    public async Task OrdersByCreatedTimeThenIdAndPaginatesAfterCounting()
    {
        using var db = new Database();
        await db.Credit(1m);
        await db.Credit(2m);
        await db.Credit(3m);
        var ids = await db.Context.WalletEntries.OrderBy(entry => entry.Id).Select(entry => entry.Id).ToArrayAsync();
        // Equal timestamps exercise the stable tie-break without changing production ledger code.
        await db.Context.WalletEntries.Where(entry => ids.Contains(entry.Id)).ExecuteUpdateAsync(
            setters => setters.SetProperty(entry => entry.CreatedAtUtc, Now));
        await db.Context.WalletEntries.Where(entry => entry.Id == ids[0]).ExecuteUpdateAsync(
            setters => setters.SetProperty(entry => entry.CreatedAtUtc, Now.AddDays(-1)));
        var first = await db.Service.ListTransactionsAsync(1, page: 1, pageSize: 2);
        var second = await db.Service.ListTransactionsAsync(1, page: 2, pageSize: 2);
        Assert.Equal(new[] { ids[2], ids[1] }, first.Items.Select(item => item.Id));
        Assert.Equal(ids[0], Assert.Single(second.Items).Id);
        Assert.Equal(3, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(1, first.Page);
        Assert.Equal(2, first.PageSize);
        Assert.Empty((await db.Service.ListTransactionsAsync(1, page: 3, pageSize: 2)).Items);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(-1, 20)]
    [InlineData(1, 0)]
    [InlineData(1, 101)]
    public async Task RejectsInvalidPageAndPageSize(int page, int pageSize)
    {
        using var db = new Database();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            db.Service.ListTransactionsAsync(1, page: page, pageSize: pageSize));
    }

    [Fact]
    public async Task HoldsOnlyAppearWhenConsumedIntoRealDebits()
    {
        using var db = new Database();
        await db.Credit(100m);
        var hold = await db.Service.CreateHoldAsync(1, "IRR", 20m, Now.AddHours(1));
        Assert.Single((await db.Service.ListTransactionsAsync(1)).Items);
        await db.Service.ConsumeHoldAsync(1, "IRR", hold);
        var movements = (await db.Service.ListTransactionsAsync(1)).Items;
        Assert.Equal(2, movements.Count);
        Assert.Contains(movements, item => item.Direction == WalletEntryDirection.Debit && item.Amount == 20m);

        var released = await db.Service.CreateHoldAsync(1, "IRR", 10m, Now.AddHours(1));
        await db.Service.ReleaseHoldAsync(1, "IRR", released);
        Assert.Equal(2, (await db.Service.ListTransactionsAsync(1)).TotalCount);
        await db.Service.CreateHoldAsync(1, "IRR", 5m, Now.AddMinutes(1));
        db.Clock.UtcNow = Now.AddMinutes(1);
        Assert.Equal(1, await db.Service.ExpireHoldsAsync(1, "IRR"));
        Assert.Equal(2, (await db.Service.ListTransactionsAsync(1)).TotalCount);
    }

    [Fact]
    public async Task PendingAndApprovedWithdrawalsDoNotAppearButPaidAllocationDebitsDo()
    {
        using var db = new Database();
        await db.Credit(30m);
        await db.Credit(70m);
        var request = await db.Service.CreateWithdrawalAsync(1, "IRR", 80m);
        Assert.Equal(2, (await db.Service.ListTransactionsAsync(1)).TotalCount);
        await db.Service.ApproveWithdrawalAsync(request.Id, 3);
        Assert.Equal(2, (await db.Service.ListTransactionsAsync(1)).TotalCount);
        await db.Service.PayWithdrawalAsync(request.Id, 3, new MarkWalletWithdrawalPaidRequest
        {
            PayoutMethod = SettlementPaymentMethod.BankTransfer,
            ReferenceNumber = "PAY-123", PaidAtUtc = new DateTimeOffset(Now)
        });
        var page = await db.Service.ListTransactionsAsync(1);
        var debits = page.Items.Where(item => item.Direction == WalletEntryDirection.Debit).ToArray();
        Assert.Equal(2, debits.Length);
        Assert.Equal(80m, debits.Sum(item => item.Amount));
        Assert.Equal(await db.Context.WalletEntries.CountAsync(), page.TotalCount);
        Assert.All(debits, item => Assert.True(item.Amount > 0));
    }

    [Fact]
    public async Task PersistedRestoreCreditAppearsWithoutSynthesizingExpiryOrRunningBalance()
    {
        using var db = new Database();
        var lotId = await db.Credit(100m);
        var accountId = await db.Context.WalletLots.Where(lot => lot.Id == lotId)
            .Select(lot => lot.WalletAccountId).SingleAsync();
        db.Context.WalletEntries.Add(new WalletEntry
        {
            WalletAccountId = accountId, WalletLotId = lotId,
            Direction = WalletEntryDirection.Debit, Amount = 40m
        });
        await db.Context.SaveChangesAsync();
        // CancellationFunding writes this same existing-lot Credit shape for Wallet restore.
        db.Context.WalletEntries.Add(new WalletEntry
        {
            WalletAccountId = accountId, WalletLotId = lotId,
            Direction = WalletEntryDirection.Credit, Amount = 15m, CreatedByUserId = 3
        });
        await db.Context.SaveChangesAsync();
        var result = await db.Service.ListTransactionsAsync(1);
        Assert.Equal(3, result.TotalCount);
        Assert.Contains(result.Items, item => item.Direction == WalletEntryDirection.Credit && item.Amount == 15m);
        Assert.DoesNotContain(typeof(WalletTransactionResponse).GetProperties(), property => property.Name.Contains("Balance"));
        Assert.Equal(75m, (await db.Service.GetBalanceAsync(1, "IRR")).Balance);
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
            Context = new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=15")
                .AddInterceptors(SqliteTestFunctions.LenInterceptor).Options);
            Context.Database.EnsureCreated();
            Context.Users.AddRange(new User { Id = 1 }, new User { Id = 2 }, new User { Id = 3 });
            Context.SaveChanges();
        }
        public Task<int> Credit(decimal amount, string currency = "IRR", int userId = 1) =>
            Service.CreateCreditAsync(new(userId, currency, amount, WalletSourceType.CashReceived));
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
