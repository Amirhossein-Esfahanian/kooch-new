using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services.Wallet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WalletFoundationTests
{
    private static readonly DateTime Now = new(2026, 9, 30, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task CreditCreatesAccountLotAndEntryAndReusesAccountForNextCredit()
    {
        using var db = new Database();
        var first = await db.Service.CreateCreditAsync(Credit(125.25m) with
        {
            Currency = " irr ", CreatedByUserId = 2, Reason = "  received  ", SourceReference = "  ref-1  "
        });
        await db.Service.CreateCreditAsync(Credit(20m));
        db.Context.ChangeTracker.Clear();
        var account = await db.Context.WalletAccounts.SingleAsync();
        Assert.Equal(1, account.UserId);
        Assert.Equal("IRR", account.Currency);
        Assert.Equal(2, await db.Context.WalletLots.CountAsync());
        var lot = await db.Context.WalletLots.SingleAsync(lot => lot.Id == first);
        Assert.True(lot.IsWithdrawable);
        Assert.Equal(WalletSourceType.CashReceived, lot.SourceType);
        Assert.Equal(2, lot.CreatedByUserId);
        Assert.Equal("received", lot.Reason);
        Assert.Equal("ref-1", lot.SourceReference);
        Assert.Null(lot.ExpiresAtUtc);
        var entry = await db.Context.WalletEntries.SingleAsync(entry => entry.WalletLotId == first);
        Assert.Equal(account.Id, entry.WalletAccountId);
        Assert.Equal(125.25m, entry.Amount);
        Assert.Equal(WalletEntryDirection.Credit, entry.Direction);
        Assert.Equal(145.25m, (await db.Service.GetBalanceAsync(1, "IRR")).Balance);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1.001")]
    [InlineData("10000000000000000")]
    public async Task InvalidCreditAmountNeverCreatesFunds(string amount)
    {
        using var db = new Database();
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateCreditAsync(
            Credit(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture))));
        Assert.Empty(await db.Context.WalletAccounts.ToListAsync());
        Assert.Empty(await db.Context.WalletLots.ToListAsync());
        Assert.Empty(await db.Context.WalletEntries.ToListAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("IR")]
    [InlineData("IRRR")]
    [InlineData("123")]
    public async Task InvalidCurrencyIsRejected(string currency)
    {
        using var db = new Database();
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateCreditAsync(Credit(10) with { Currency = currency }));
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.GetBalanceAsync(1, currency));
    }

    [Fact]
    public async Task MissingUserAndUnknownSourceFailWithoutCreatingFunds()
    {
        using var db = new Database();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => db.Service.CreateCreditAsync(Credit(10) with { UserId = 999 }));
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateCreditAsync(Credit(10) with { SourceType = (WalletSourceType)99 }));
        Assert.Empty(await db.Context.WalletAccounts.ToListAsync());
    }

    [Fact]
    public async Task UsersAndCurrenciesAreIndependent()
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(100));
        await db.Service.CreateCreditAsync(Credit(2.35m) with { Currency = "USD" });
        await db.Service.CreateCreditAsync(Credit(600) with { UserId = 2 });
        Assert.Equal(3, await db.Context.WalletAccounts.CountAsync());
        Assert.Equal(100m, (await db.Service.GetBalanceAsync(1, "IRR")).Balance);
        Assert.Equal(2.35m, (await db.Service.GetBalanceAsync(1, "USD")).Balance);
        Assert.Equal(600m, (await db.Service.GetBalanceAsync(2, "IRR")).Balance);
        Assert.Equal(0m, (await db.Service.GetBalanceAsync(2, "USD")).Balance);
    }

    [Fact]
    public async Task CompetingContextsCannotPersistDuplicateAccount()
    {
        using var db = new Database();
        await using var competitor = db.NewContext();
        Assert.False(await db.Context.WalletAccounts.AnyAsync());
        Assert.False(await competitor.WalletAccounts.AnyAsync());
        db.Context.WalletAccounts.Add(new WalletAccount { UserId = 1, Currency = "IRR" });
        competitor.WalletAccounts.Add(new WalletAccount { UserId = 1, Currency = "IRR" });
        await db.Context.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateException>(() => competitor.SaveChangesAsync());
        Assert.Single(await db.Context.WalletAccounts.ToListAsync());
    }

    [Theory]
    [InlineData(WalletSourceType.CashReceived, true)]
    [InlineData(WalletSourceType.PromotionalCredit, false)]
    public async Task SourceDeterminesSnapshotAndBalanceSplit(WalletSourceType source, bool withdrawable)
    {
        using var db = new Database();
        var expiry = Now.AddDays(5);
        await db.Service.CreateCreditAsync(Credit(10.25m) with { SourceType = source, ExpiresAtUtc = expiry });
        var lot = await db.Context.WalletLots.SingleAsync();
        Assert.Equal(withdrawable, lot.IsWithdrawable);
        Assert.Equal(expiry, lot.ExpiresAtUtc);
        var balance = await db.Service.GetBalanceAsync(1, "IRR");
        Assert.Equal(10.25m, balance.Balance);
        Assert.Equal(withdrawable ? 10.25m : 0m, balance.WithdrawableBalance);
        Assert.Equal(withdrawable ? 0m : 10.25m, balance.NonWithdrawableBalance);
        Assert.DoesNotContain(typeof(WalletCreditCommand).GetProperties(), p => p.Name == "IsWithdrawable");
    }

    [Fact]
    public async Task MixedBalancesAreExactAndDerivedFromCreditsMinusDebits()
    {
        using var db = new Database();
        var cashLotId = await db.Service.CreateCreditAsync(Credit(100.01m));
        await db.Service.CreateCreditAsync(Credit(20.34m) with { SourceType = WalletSourceType.PromotionalCredit });
        // Seed a persisted ledger fact; no debit/spend service or endpoint is introduced.
        var cashLot = await db.Context.WalletLots.SingleAsync(l => l.Id == cashLotId);
        db.Context.WalletEntries.Add(new WalletEntry
        {
            WalletAccountId = cashLot.WalletAccountId, WalletLotId = cashLotId,
            Direction = WalletEntryDirection.Debit, Amount = 10.02m
        });
        await db.Context.SaveChangesAsync();
        var result = await db.Service.GetBalanceAsync(1, "IRR");
        Assert.Equal(89.99m, result.WithdrawableBalance);
        Assert.Equal(20.34m, result.NonWithdrawableBalance);
        Assert.Equal(110.33m, result.Balance);
    }

    [Fact]
    public async Task ExpiryBoundaryExcludesBothKindsWithoutDeletingHistory()
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(30) with { ExpiresAtUtc = Now.AddMinutes(1) });
        await db.Service.CreateCreditAsync(Credit(40) with
        {
            SourceType = WalletSourceType.PromotionalCredit, ExpiresAtUtc = Now.AddMinutes(1)
        });
        await db.Service.CreateCreditAsync(Credit(5));
        Assert.Equal(75m, (await db.Service.GetBalanceAsync(1, "IRR")).Balance);
        db.Clock.UtcNow = Now.AddMinutes(1);
        var result = await db.Service.GetBalanceAsync(1, "IRR");
        Assert.Equal(5m, result.Balance);
        Assert.Equal(5m, result.WithdrawableBalance);
        Assert.Equal(0m, result.NonWithdrawableBalance);
        Assert.Equal(3, await db.Context.WalletLots.CountAsync());
        Assert.Equal(3, await db.Context.WalletEntries.CountAsync());
    }

    [Fact]
    public async Task PastOrNonUtcExpiryIsRejected()
    {
        using var db = new Database();
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateCreditAsync(Credit(1) with { ExpiresAtUtc = Now }));
        await Assert.ThrowsAsync<ArgumentException>(() => db.Service.CreateCreditAsync(Credit(1) with
        {
            ExpiresAtUtc = DateTime.SpecifyKind(Now.AddDays(1), DateTimeKind.Unspecified)
        }));
    }

    [Fact]
    public async Task GetIsReadOnlyAndUsesClaimsNotUserInput()
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(999) with { UserId = 2 });
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, UserRole.Client.ToString())
        ], "test"));
        http.Request.QueryString = new QueryString("?userId=2&walletAccountId=1");
        var controller = new AccountWalletController(db.Service) { ControllerContext = new() { HttpContext = http } };
        var result = Assert.IsType<OkObjectResult>((await controller.Get()).Result);
        Assert.Equal(new WalletBalanceResponse("IRR", 0, 0, 0), result.Value);
        Assert.Single(await db.Context.WalletAccounts.ToListAsync());
        Assert.False(await db.Context.WalletAccounts.AnyAsync(a => a.UserId == 1));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(AccountWalletController), typeof(AuthorizeAttribute)));
        Assert.DoesNotContain(typeof(AccountWalletController).GetMethod(nameof(AccountWalletController.Get))!.GetParameters(),
            parameter => parameter.Name == "userId");
        http.User = new ClaimsPrincipal(new ClaimsIdentity());
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.Get());
    }

    [Theory]
    [InlineData("amount")]
    [InlineData("direction")]
    [InlineData("lot")]
    [InlineData("soft-delete")]
    [InlineData("delete")]
    public async Task LedgerCannotBeModifiedOrDeleted(string change)
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(10));
        var entry = await db.Context.WalletEntries.SingleAsync();
        switch (change)
        {
            case "amount": entry.Amount = 20; break;
            case "direction": entry.Direction = WalletEntryDirection.Debit; break;
            case "lot": entry.WalletLotId++; break;
            case "soft-delete": entry.IsDeleted = true; break;
            case "delete": db.Context.Remove(entry); break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData("source")]
    [InlineData("withdrawability")]
    [InlineData("expiry")]
    [InlineData("actor")]
    [InlineData("reference")]
    [InlineData("reason")]
    [InlineData("account")]
    [InlineData("delete")]
    public async Task LotProvenanceCannotChange(string change)
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(10));
        db.Context.ChangeTracker.Clear();
        var lot = await db.Context.WalletLots.SingleAsync();
        switch (change)
        {
            case "source": lot.SourceType = WalletSourceType.PromotionalCredit; break;
            case "withdrawability": lot.IsWithdrawable = false; break;
            case "expiry": lot.ExpiresAtUtc = Now.AddDays(1); break;
            case "actor": lot.CreatedByUserId = 2; break;
            case "reference": lot.SourceReference = "changed"; break;
            case "reason": lot.Reason = "changed"; break;
            case "account": lot.WalletAccountId++; break;
            case "delete": db.Context.Remove(lot); break;
        }
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData("currency")]
    [InlineData("user")]
    [InlineData("delete")]
    public async Task AccountOwnershipAndCurrencyCannotChange(string change)
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(10));
        db.Context.ChangeTracker.Clear();
        var account = await db.Context.WalletAccounts.SingleAsync();
        if (change == "currency") account.Currency = "USD";
        else if (change == "user") account.UserId = 2;
        else db.Context.Remove(account);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task AllSaveOverloadsEnforceAppendOnlyAndUnrelatedUserUpdatesWork()
    {
        using var db = new Database();
        await db.Service.CreateCreditAsync(Credit(10));
        var entry = await db.Context.WalletEntries.SingleAsync();
        entry.Amount = 20;
        Assert.Throws<InvalidOperationException>(() => db.Context.SaveChanges());
        Assert.Throws<InvalidOperationException>(() => db.Context.SaveChanges(false));
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Context.SaveChangesAsync(false));
        db.Context.ChangeTracker.Clear();
        var user = await db.Context.Users.SingleAsync(u => u.Id == 1);
        user.FirstName = "Updated";
        await db.Context.SaveChangesAsync();
        Assert.Equal("Updated", (await db.Context.Users.SingleAsync(u => u.Id == 1)).FirstName);
    }

    [Fact]
    public async Task DatabaseRejectsAnEntryWhoseLotBelongsToAnotherAccount()
    {
        using var db = new Database();
        var firstLot = await db.Service.CreateCreditAsync(Credit(10));
        await db.Service.CreateCreditAsync(Credit(10) with { UserId = 2 });
        var otherAccount = await db.Context.WalletAccounts.SingleAsync(a => a.UserId == 2);
        db.Context.ChangeTracker.Clear();
        db.Context.WalletEntries.Add(new WalletEntry
        {
            WalletAccountId = otherAccount.Id, WalletLotId = firstLot, Amount = 5
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task FailureAfterSavingRollsBackAccountLotAndLedgerTogether()
    {
        using var db = new Database();
        db.Failure.Enabled = true;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.CreateCreditAsync(Credit(10)));
        Assert.Empty(await db.Context.WalletAccounts.ToListAsync());
        Assert.Empty(await db.Context.WalletLots.ToListAsync());
        Assert.Empty(await db.Context.WalletEntries.ToListAsync());
        db.Failure.Enabled = false;
        await db.Service.CreateCreditAsync(Credit(10));
        Assert.Single(await db.Context.WalletAccounts.ToListAsync());
    }

    [Fact]
    public async Task CreditDoesNotSaveUnrelatedPendingChangesOrOwnAnAmbientTransaction()
    {
        using var db = new Database();
        (await db.Context.Users.SingleAsync(u => u.Id == 1)).FirstName = "Pending";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.CreateCreditAsync(Credit(1)));
        db.Context.ChangeTracker.Clear();
        await using var transaction = await db.Context.Database.BeginTransactionAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.Service.CreateCreditAsync(Credit(1)));
    }

    [Fact]
    public void SqlServerModelHasUniqueCurrencyAccountPrecisionAndNoMutableBalances()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        var account = model.FindEntityType(typeof(WalletAccount))!;
        Assert.True(Assert.Single(account.GetIndexes(), i => i.Properties.Select(p => p.Name)
            .SequenceEqual(new[] { "UserId", "Currency" })).IsUnique);
        Assert.Equal(3, account.FindProperty("Currency")!.GetMaxLength());
        Assert.True(account.FindProperty("RowVersion")!.IsConcurrencyToken);
        Assert.Contains(account.GetCheckConstraints(), c => c.Name == "CK_WalletAccounts_CurrencyLength");
        var entry = model.FindEntityType(typeof(WalletEntry))!;
        Assert.Equal(18, entry.FindProperty("Amount")!.GetPrecision());
        Assert.Equal(2, entry.FindProperty("Amount")!.GetScale());
        Assert.Contains(entry.GetForeignKeys(), fk => fk.Properties.Select(p => p.Name)
            .SequenceEqual(new[] { "WalletLotId", "WalletAccountId" }));
        Assert.Contains(entry.GetCheckConstraints(), c => c.Name == "CK_WalletEntries_Amount");
        foreach (var type in new[] { typeof(WalletAccount), typeof(WalletLot) })
            Assert.DoesNotContain(model.FindEntityType(type)!.GetProperties(), p =>
                p.Name.Contains("Balance") || p.Name == "RemainingAmount");
    }

    [Fact]
    public void MigrationOnlyAddsWalletFoundation()
    {
        var operations = new AddUserWalletFoundation().UpOperations;
        Assert.Equal(new[] { "WalletAccounts", "WalletEntries", "WalletLots" },
            operations.OfType<CreateTableOperation>().Select(t => t.Name).Order().ToArray());
        Assert.All(operations, op => Assert.True(op is CreateTableOperation or CreateIndexOperation));
        Assert.All(operations.OfType<CreateIndexOperation>(), op => Assert.StartsWith("Wallet", op.Table));
        var unique = Assert.Single(operations.OfType<CreateIndexOperation>(), i => i.IsUnique);
        Assert.Equal(new[] { "UserId", "Currency" }, unique.Columns);
        Assert.Equal("WalletAccounts", unique.Table);
        Assert.Contains(operations.OfType<CreateTableOperation>().Single(t => t.Name == "WalletAccounts")
            .CheckConstraints, c => c.Name == "CK_WalletAccounts_CurrencyLength");
    }

    [Fact]
    public void EveryWalletForeignKeyUsesNoActionInModelAndMigration()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        foreach (var type in new[] { typeof(WalletAccount), typeof(WalletLot), typeof(WalletEntry) })
        {
            var entity = model.FindEntityType(type)!;
            Assert.All(entity.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        }
        var operations = new AddUserWalletFoundation().UpOperations.OfType<CreateTableOperation>().ToArray();
        Assert.All(operations.SelectMany(table => table.ForeignKeys),
            fk => Assert.Equal(ReferentialAction.NoAction, fk.OnDelete));
        var entries = Assert.Single(operations, table => table.Name == "WalletEntries");
        Assert.Contains(entries.ForeignKeys, fk => fk.Columns.SequenceEqual(new[] { "WalletLotId", "WalletAccountId" }) &&
            fk.PrincipalColumns!.SequenceEqual(new[] { "Id", "WalletAccountId" }));
    }

    [Fact]
    public async Task DatabaseRejectsParentDeletesAndWrongCurrencyLengths()
    {
        using var db = new Database();
        var lotId = await db.Service.CreateCreditAsync(Credit(10));
        var accountId = (await db.Context.WalletAccounts.SingleAsync()).Id;
        var entryId = (await db.Context.WalletEntries.SingleAsync()).Id;
        await Assert.ThrowsAsync<SqliteException>(() => db.Context.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM WalletLots WHERE Id = {lotId}"));
        await Assert.ThrowsAsync<SqliteException>(() => db.Context.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM WalletAccounts WHERE Id = {accountId}"));
        await Assert.ThrowsAsync<SqliteException>(() => db.Context.Database.ExecuteSqlRawAsync(
            "DELETE FROM Users WHERE Id = 1"));
        foreach (var currency in new[] { "", "IR", "IRRR" })
            await Assert.ThrowsAsync<SqliteException>(() => db.Context.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO WalletAccounts (UserId, Currency, RowVersion, CreatedAtUtc, IsDeleted) VALUES (2, {currency}, {Array.Empty<byte>()}, {Now}, {false})"));
        Assert.Equal(1, await db.Context.WalletAccounts.CountAsync());
        Assert.Equal(lotId, (await db.Context.WalletLots.SingleAsync()).Id);
        Assert.Equal(entryId, (await db.Context.WalletEntries.SingleAsync()).Id);
    }

    [Fact]
    public async Task WalletCreditAndReadLeavePropertyFinanceAndSettlementsUntouched()
    {
        using var db = new Database();
        var property = new Property
        {
            OwnerId = 2, Name = "Property", Slug = "property",
            Destination = new Destination { Name = "City", Slug = "city" }
        };
        var payable = new FinancialEntry
        {
            Property = property, Amount = 123.45m, Currency = "IRR",
            EntryType = FinancialEntryType.PropertyPayable, CorrelationKey = "existing-payable",
            EffectiveAtUtc = Now, PayableDueDate = DateOnly.FromDateTime(Now)
        };
        var settlement = new Settlement
        {
            Property = property, SettlementNumber = "S-123456", TotalAmount = 123.45m, Currency = "IRR",
            Items = [new SettlementItem { FinancialEntry = payable, ReservationNumberSnapshot = "R-123456" }]
        };
        db.Context.Settlements.Add(settlement);
        await db.Context.SaveChangesAsync();
        var priorPayable = db.Context.Entry(payable).CurrentValues.Clone();
        var priorSettlement = db.Context.Entry(settlement).CurrentValues.Clone();
        await db.Service.CreateCreditAsync(Credit(25));
        await db.Service.GetBalanceAsync(1, "IRR");
        db.Context.ChangeTracker.Clear();
        var savedPayable = await db.Context.FinancialEntries.SingleAsync();
        var savedSettlement = await db.Context.Settlements.SingleAsync();
        Assert.Equal(priorPayable.Properties.Select(p => priorPayable[p]),
            priorPayable.Properties.Select(p => db.Context.Entry(savedPayable).CurrentValues[p]));
        Assert.Equal(priorSettlement.Properties.Select(p => priorSettlement[p]),
            priorSettlement.Properties.Select(p => db.Context.Entry(savedSettlement).CurrentValues[p]));
        Assert.Single(await db.Context.SettlementItems.ToListAsync());
    }

    private static WalletCreditCommand Credit(decimal amount) => new(1, "IRR", amount, WalletSourceType.CashReceived);

    private sealed class Clock : TimeProvider
    {
        public DateTime UtcNow { get; set; } = Now;
        public override DateTimeOffset GetUtcNow() => new(UtcNow);
    }

    private sealed class FailAfterSave : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (Enabled) throw new InvalidOperationException("Simulated failure before commit.");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Database : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        public TestContext Context { get; }
        public Clock Clock { get; } = new();
        public FailAfterSave Failure { get; } = new();
        public WalletService Service => new(Context, Clock);
        public Database()
        {
            connection.Open();
            Context = NewContext();
            Context.Database.EnsureCreated();
            Context.Users.AddRange(new User { Id = 1, FirstName = "One" }, new User { Id = 2, FirstName = "Two" });
            Context.SaveChanges();
        }
        public TestContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection).AddInterceptors(Failure).Options);
        public void Dispose() { Context.Dispose(); connection.Dispose(); }
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
