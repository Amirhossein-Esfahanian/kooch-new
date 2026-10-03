using Kooch.Api.Data;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

// Set this only to a SQL Server test instance. Each run creates and deletes its own database.
public sealed class SqlServerWalletFactAttribute : FactAttribute
{
    public const string ConnectionVariable = "KOOCH_SQLSERVER_TEST_CONNECTION";

    public SqlServerWalletFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(ConnectionVariable)))
            Skip = $"Set {ConnectionVariable} to a SQL Server test instance.";
    }
}

public sealed class WalletSqlServerConcurrencyTests(SqlServerWalletDatabase database) : IClassFixture<SqlServerWalletDatabase>
{
    [SqlServerWalletFact]
    public async Task TwoWithdrawalsCannotReserveTheSameFunds()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 80)),
            () => database.AttemptAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 80)));

        Assert.Single(outcomes, outcome => outcome);
        await using var context = database.NewContext();
        var requests = await context.WalletWithdrawalRequests.AsNoTracking()
            .Where(request => request.WalletAccount.UserId == userId).ToListAsync();
        Assert.Single(requests);
        Assert.Equal(WalletWithdrawalStatus.Pending, requests[0].Status);
        Assert.Equal(80, await ActiveWithdrawalAmount(context, userId));
        Assert.Empty(await context.WalletEntries.AsNoTracking().Where(entry =>
            entry.WalletAccount.UserId == userId && entry.Direction == WalletEntryDirection.Debit).ToListAsync());
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task WithdrawalAndBookingHoldCannotBothReserveEightyOfOneHundred()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 80)),
            () => database.AttemptAsync(service => service.CreateHoldAsync(userId, "IRR", 80, DateTime.UtcNow.AddHours(1))));

        Assert.Single(outcomes, outcome => outcome);
        await using var context = database.NewContext();
        var withdrawals = await ActiveWithdrawalAmount(context, userId);
        var holds = await ActiveHoldAmount(context, userId);
        Assert.Equal(80, withdrawals + holds);
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task TwoBookingHoldsCannotReserveTheSameFunds()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.CreateHoldAsync(userId, "IRR", 80, DateTime.UtcNow.AddHours(1))),
            () => database.AttemptAsync(service => service.CreateHoldAsync(userId, "IRR", 80, DateTime.UtcNow.AddHours(1))));

        Assert.Single(outcomes, outcome => outcome);
        await using var context = database.NewContext();
        Assert.Equal(80, await ActiveHoldAmount(context, userId));
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task ConcurrentApproveAndRejectHaveOneWinner()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var request = await database.WithServiceAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 60));
        var requestId = request.Id;
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.ApproveWithdrawalAsync(requestId, database.AdminUserId)),
            () => database.AttemptAsync(service => service.RejectWithdrawalAsync(requestId, database.AdminUserId)));

        Assert.Single(outcomes, outcome => outcome);
        await using var context = database.NewContext();
        var persisted = await context.WalletWithdrawalRequests.AsNoTracking().SingleAsync(item => item.Id == requestId);
        Assert.Contains(persisted.Status, new[] { WalletWithdrawalStatus.Approved, WalletWithdrawalStatus.Rejected });
        var allocation = Assert.Single(await context.WalletWithdrawalAllocations.AsNoTracking()
            .Where(item => item.WalletWithdrawalRequestId == requestId).ToListAsync());
        Assert.Equal(60, allocation.Amount);
        Assert.Equal(persisted.Status == WalletWithdrawalStatus.Approved ? 60 : 0,
            await ActiveWithdrawalAmount(context, userId));
        Assert.Empty(await context.WalletEntries.AsNoTracking().Where(entry =>
            entry.WalletAccount.UserId == userId && entry.Direction == WalletEntryDirection.Debit).ToListAsync());
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task ConcurrentPaidExecutionsCreateExactlyOneDebitPerAllocation()
    {
        var userId = await database.CreateFundedUserAsync(30);
        await database.WithServiceAsync(service => service.CreateCreditAsync(
            new(userId, "IRR", 70, WalletSourceType.CashReceived)));
        var request = await database.WithServiceAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 80));
        await database.WithServiceAsync(service => service.ApproveWithdrawalAsync(request.Id, database.AdminUserId));
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.PayWithdrawalAsync(request.Id, database.AdminUserId, Payment("FIRST"))),
            () => database.AttemptAsync(service => service.PayWithdrawalAsync(request.Id, database.AdminUserId, Payment("SECOND"))));

        Assert.Single(outcomes, outcome => outcome);
        await using var context = database.NewContext();
        var paid = await context.WalletWithdrawalRequests.AsNoTracking().SingleAsync(item => item.Id == request.Id);
        Assert.Equal(WalletWithdrawalStatus.Paid, paid.Status);
        Assert.NotNull(paid.PaidAtUtc);
        Assert.Contains(paid.PayoutReferenceNumber, new[] { "FIRST", "SECOND" });
        var allocations = await context.WalletWithdrawalAllocations.AsNoTracking()
            .Where(item => item.WalletWithdrawalRequestId == request.Id).OrderBy(item => item.Id).ToListAsync();
        var debits = await context.WalletEntries.AsNoTracking()
            .Where(entry => entry.WalletAccount.UserId == userId && entry.Direction == WalletEntryDirection.Debit)
            .ToListAsync();
        Assert.Equal(2, allocations.Count);
        Assert.Equal(allocations.Count, debits.Count);
        Assert.Equal(80, debits.Sum(entry => entry.Amount));
        Assert.All(allocations, allocation =>
        {
            var debit = Assert.Single(debits, entry => entry.WalletWithdrawalAllocationId == allocation.Id);
            Assert.Equal(allocation.Amount, debit.Amount);
            Assert.Equal(allocation.WalletLotId, debit.WalletLotId);
        });
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task PaidFailureBeforeCallerCommitRollsBackPayoutAndDebits()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var request = await database.WithServiceAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 40));
        await database.WithServiceAsync(service => service.ApproveWithdrawalAsync(request.Id, database.AdminUserId));

        await using (var context = database.NewContext())
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                await new WalletService(context, TimeProvider.System)
                    .PayWithdrawalAsync(request.Id, database.AdminUserId, Payment("ROLLBACK"));
                throw new InvalidOperationException("Simulated caller failure before commit.");
            });
            Assert.Equal("Simulated caller failure before commit.", failure.Message);
            await transaction.RollbackAsync();
        }

        await using var fresh = database.NewContext();
        var unchanged = await fresh.WalletWithdrawalRequests.AsNoTracking().SingleAsync(item => item.Id == request.Id);
        Assert.Equal(WalletWithdrawalStatus.Approved, unchanged.Status);
        Assert.Null(unchanged.PaidAtUtc);
        Assert.Null(unchanged.PayoutReferenceNumber);
        Assert.Empty(await fresh.WalletEntries.AsNoTracking().Where(entry =>
            entry.WalletAccount.UserId == userId && entry.Direction == WalletEntryDirection.Debit).ToListAsync());
        await database.AssertLotInvariantAsync(userId);
    }

    [SqlServerWalletFact]
    public async Task PaidCannotRaceWithRejectedAfterApproval()
    {
        var userId = await database.CreateFundedUserAsync(100);
        var request = await database.WithServiceAsync(service => service.CreateWithdrawalAsync(userId, "IRR", 40));
        await database.WithServiceAsync(service => service.ApproveWithdrawalAsync(request.Id, database.AdminUserId));
        var outcomes = await Race(
            () => database.AttemptAsync(service => service.PayWithdrawalAsync(request.Id, database.AdminUserId, Payment("PAID"))),
            () => database.AttemptAsync(service => service.RejectWithdrawalAsync(request.Id, database.AdminUserId)));
        Assert.Equal(new[] { true, false }, outcomes);
        await using var context = database.NewContext();
        Assert.Equal(WalletWithdrawalStatus.Paid,
            (await context.WalletWithdrawalRequests.AsNoTracking().SingleAsync(item => item.Id == request.Id)).Status);
        Assert.Single(await context.WalletEntries.AsNoTracking().Where(entry =>
            entry.WalletAccount.UserId == userId && entry.Direction == WalletEntryDirection.Debit).ToListAsync());
        await database.AssertLotInvariantAsync(userId);
    }

    private static MarkWalletWithdrawalPaidRequest Payment(string reference) => new()
    {
        PayoutMethod = SettlementPaymentMethod.BankTransfer,
        ReferenceNumber = reference,
        PaidAtUtc = DateTimeOffset.UtcNow
    };

    private static async Task<bool[]> Race(Func<Task<bool>> first, Func<Task<bool>> second)
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<bool> Start(Func<Task<bool>> operation)
        {
            await gate.Task;
            return await operation();
        }
        var firstTask = Start(first);
        var secondTask = Start(second);
        gate.SetResult();
        return await Task.WhenAll(firstTask, secondTask);
    }

    private static async Task<decimal> ActiveWithdrawalAmount(KoochDbContext context, int userId) =>
        await context.WalletWithdrawalAllocations.AsNoTracking()
            .Where(item => item.WalletLot.WalletAccount.UserId == userId &&
                (item.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Pending ||
                 item.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Approved))
            .SumAsync(item => (decimal?)item.Amount) ?? 0;

    private static async Task<decimal> ActiveHoldAmount(KoochDbContext context, int userId) =>
        await context.WalletHoldAllocations.AsNoTracking()
            .Where(item => item.WalletLot.WalletAccount.UserId == userId &&
                item.WalletHold.Status == WalletHoldStatus.Active && item.WalletHold.ExpiresAtUtc > DateTime.UtcNow)
            .SumAsync(item => (decimal?)item.Amount) ?? 0;
}

public sealed class SqlServerWalletDatabase : IAsyncLifetime
{
    private string? connectionString;
    public int AdminUserId { get; private set; }

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable(SqlServerWalletFactAttribute.ConnectionVariable);
        if (string.IsNullOrWhiteSpace(configured)) return;
        var builder = new SqlConnectionStringBuilder(configured)
        {
            InitialCatalog = $"KoochWalletConcurrency_{Guid.NewGuid():N}",
            Pooling = false,
            TrustServerCertificate = true
        };
        connectionString = builder.ConnectionString;
        await using var context = NewContext();
        await context.Database.EnsureCreatedAsync();
        var admin = new User { FirstName = "Wallet", LastName = "Reviewer" };
        context.Users.Add(admin);
        await context.SaveChangesAsync();
        AdminUserId = admin.Id;
    }

    public KoochDbContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlServer(connectionString ?? throw new InvalidOperationException("SQL Server Wallet test database is not configured."),
            options => options.CommandTimeout(30)).Options);

    public async Task<int> CreateFundedUserAsync(decimal amount)
    {
        await using var context = NewContext();
        var user = new User { FirstName = "Wallet", LastName = "Guest" };
        context.Users.Add(user);
        await context.SaveChangesAsync();
        var userId = user.Id;
        await WithServiceAsync(service => service.CreateCreditAsync(
            new(userId, "IRR", amount, WalletSourceType.CashReceived)));
        return userId;
    }

    public async Task<T> WithServiceAsync<T>(Func<WalletService, Task<T>> operation)
    {
        await using var context = NewContext();
        return await operation(new WalletService(context, TimeProvider.System));
    }

    public async Task<bool> AttemptAsync<T>(Func<WalletService, Task<T>> operation)
    {
        try
        {
            await WithServiceAsync(operation);
            return true;
        }
        catch (InvalidOperationException error) when (error.Message is
            "Insufficient available wallet balance." or
            "Insufficient available withdrawable wallet balance." or
            "Only Pending wallet withdrawals can be reviewed." or
            "Only Approved wallet withdrawals can be paid.")
        {
            return false;
        }
    }

    public async Task AssertLotInvariantAsync(int userId)
    {
        await using var context = NewContext();
        var now = DateTime.UtcNow;
        var lots = await context.WalletLots.AsNoTracking().Where(lot => lot.WalletAccount.UserId == userId).ToListAsync();
        foreach (var lot in lots)
        {
            var entries = await context.WalletEntries.AsNoTracking().Where(item => item.WalletLotId == lot.Id).ToListAsync();
            var holds = await context.WalletHoldAllocations.AsNoTracking()
                .Where(item => item.WalletLotId == lot.Id && item.WalletHold.Status == WalletHoldStatus.Active &&
                    item.WalletHold.ExpiresAtUtc > now).SumAsync(item => (decimal?)item.Amount) ?? 0;
            var withdrawals = await context.WalletWithdrawalAllocations.AsNoTracking()
                .Where(item => item.WalletLotId == lot.Id &&
                    (item.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Pending ||
                     item.WalletWithdrawalRequest.Status == WalletWithdrawalStatus.Approved))
                .SumAsync(item => (decimal?)item.Amount) ?? 0;
            var economicBalance = entries.Sum(item => item.Direction == WalletEntryDirection.Credit
                ? item.Amount : -item.Amount) - holds - withdrawals;
            Assert.True(economicBalance >= 0, $"Wallet lot {lot.Id} is over-reserved by {-economicBalance}.");
        }
    }

    public async Task DisposeAsync()
    {
        if (connectionString is null) return;
        await using var context = NewContext();
        await context.Database.EnsureDeletedAsync();
    }
}
