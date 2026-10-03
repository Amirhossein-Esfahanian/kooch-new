using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.Wallet;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCashbackGrantTests
{
    private static readonly DateTime Eligible = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime GrantTime = Eligible.AddDays(3);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DueGrantCreatesOneLinkedNonWithdrawableCredit(bool existingAccount)
    {
        using var database = new Database();
        if (existingAccount)
        {
            database.Context.WalletAccounts.Add(new WalletAccount { UserId = 1, Currency = "IRR" });
            await database.Context.SaveChangesAsync();
            database.Context.ChangeTracker.Clear();
        }
        var result = await database.Service.GrantAsync(1, GrantTime);
        Assert.Equal(CashbackEntitlementStatus.Granted, result.Status);
        Assert.Equal(GrantTime, result.GrantedAtUtc);
        Assert.Single(await database.Context.WalletAccounts.ToListAsync());
        var lot = Assert.Single(await database.Context.WalletLots.ToListAsync());
        var credit = Assert.Single(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal((lot.Id, credit.Id), (result.GrantedWalletLotId, result.GrantedWalletEntryId));
        Assert.Equal((1, "IRR"), ((await database.Context.WalletAccounts.SingleAsync()).UserId,
            (await database.Context.WalletAccounts.SingleAsync()).Currency));
        Assert.Equal(WalletSourceType.PromotionalCredit, lot.SourceType);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal($"cashback:entitlement:{result.Id}", lot.SourceReference);
        Assert.Equal(GrantTime.AddDays(30), lot.ExpiresAtUtc);
        Assert.NotEqual(Eligible.AddDays(30), lot.ExpiresAtUtc);
        Assert.Equal(WalletEntryDirection.Credit, credit.Direction);
        Assert.Equal(10m, credit.Amount);
        Assert.Equal((lot.WalletAccountId, lot.Id), (credit.WalletAccountId, credit.WalletLotId));
        Assert.Empty(await database.Context.Payments.ToListAsync());
        Assert.Empty(await database.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await database.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Equal(10m, result.CashbackAmount);
        Assert.Equal(10m, result.PercentageRateSnapshot);
        Assert.Equal(30, result.ExpiryDaysSnapshot);
        var history = await new WalletService(database.Context, TimeProvider.System).ListTransactionsAsync(1);
        Assert.Single(history.Items);
        Assert.Equal(10m, history.Items[0].Amount);
        var balance = await new WalletService(database.Context, TimeProvider.System).GetBalanceAsync(1, "IRR");
        Assert.Equal(0m, balance.WithdrawableBalance);
    }

    [Fact]
    public async Task ExactlyAtEligibilityGrantsButBeforeEligibilityDoesNot()
    {
        using var database = new Database();
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Service.GrantAsync(1, Eligible.AddTicks(-1)));
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await database.Context.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Equal(CashbackEntitlementStatus.Granted,
            (await database.Service.GrantAsync(1, Eligible)).Status);
    }

    [Fact]
    public async Task CancelledReservationCannotGrant()
    {
        using var database = new Database();
        var reservation = await database.Context.Reservations.SingleAsync();
        reservation.Status = ReservationStatus.Cancelled;
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Service.GrantAsync(1, GrantTime));
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await database.Context.ReservationCashbackEntitlements.SingleAsync()).Status);
    }

    [Fact]
    public async Task VoidedEntitlementCannotGrant()
    {
        using var database = new Database();
        await database.Service.VoidPendingForReservationAsync(1);
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Service.GrantAsync(1, GrantTime));
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());
    }

    [Fact]
    public async Task RetryDoesNotExtendExpiryOrCreateSecondCredit()
    {
        using var database = new Database();
        var first = await database.Service.GrantAsync(1, GrantTime);
        database.Context.ChangeTracker.Clear();
        var retry = await database.Service.GrantAsync(1, GrantTime.AddDays(10));
        Assert.Equal(first.GrantedAtUtc, retry.GrantedAtUtc);
        Assert.Equal(first.GrantedWalletLotId, retry.GrantedWalletLotId);
        Assert.Single(await database.Context.WalletLots.ToListAsync());
        Assert.Single(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal(GrantTime.AddDays(30), (await database.Context.WalletLots.SingleAsync()).ExpiresAtUtc);
    }

    [Fact]
    public async Task FailedSaveRollsBackLotEntryAndGrantLink()
    {
        using var database = new Database();
        database.Failure.FailOnSaveNumber = database.Failure.SaveCount + 2;
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Service.GrantAsync(1, GrantTime));
        database.Failure.FailOnSaveNumber = 0;
        Assert.Empty(await database.Context.WalletLots.ToListAsync());
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());
        Assert.Empty(await database.Context.WalletAccounts.ToListAsync());
        var entitlement = await database.Context.ReservationCashbackEntitlements.SingleAsync();
        Assert.Equal(CashbackEntitlementStatus.Pending, entitlement.Status);
        Assert.Null(entitlement.GrantedAtUtc);
    }

    [Fact]
    public async Task GrantedHistoryCannotBeEditedOrVoidedAndCancellationDoesNotClawBack()
    {
        using var database = new Database();
        var entitlement = await database.Service.GrantAsync(1, GrantTime);
        database.Context.ChangeTracker.Clear();
        var reservation = await database.Context.Reservations.SingleAsync();
        reservation.Status = ReservationStatus.Cancelled;
        await database.Service.VoidPendingForReservationAsync(1);
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        entitlement = await database.Context.ReservationCashbackEntitlements.SingleAsync();
        Assert.Equal(CashbackEntitlementStatus.Granted, entitlement.Status);
        Assert.Single(await database.Context.WalletEntries.ToListAsync());
        entitlement.GrantedAtUtc = GrantTime.AddDays(1);
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task MissingEntitlementIsNotFound()
    {
        using var database = new Database();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => database.Service.GrantAsync(999, GrantTime));
    }

    [Fact]
    public async Task CashbackCannotFundWithdrawal()
    {
        using var database = new Database();
        await database.Service.GrantAsync(1, GrantTime);
        database.Context.ChangeTracker.Clear();
        var wallet = new WalletService(database.Context, TimeProvider.System);
        await Assert.ThrowsAsync<InvalidOperationException>(() => wallet.CreateWithdrawalAsync(1, "IRR", 1m));
        Assert.Empty(await database.Context.WalletWithdrawalRequests.ToListAsync());
    }

    [Fact]
    public async Task ExistingHoldPrioritySpendsCashbackBeforeCash()
    {
        using var database = new Database();
        var wallet = new WalletService(database.Context, TimeProvider.System);
        var cashLotId = await wallet.CreateCreditAsync(new(1, "IRR", 20m, WalletSourceType.CashReceived));
        database.Context.ChangeTracker.Clear();
        var grant = await database.Service.GrantAsync(1, GrantTime);
        database.Context.ChangeTracker.Clear();
        var holdId = await wallet.CreateHoldAsync(1, "IRR", 15m, DateTime.UtcNow.AddMinutes(10));
        var allocations = await database.Context.WalletHoldAllocations
            .Where(row => row.WalletHoldId == holdId).ToListAsync();
        Assert.Contains(allocations, row => row.WalletLotId == grant.GrantedWalletLotId && row.Amount == 10m);
        Assert.Contains(allocations, row => row.WalletLotId == cashLotId && row.Amount == 5m);
    }

    private sealed class FailAfterSave : SaveChangesInterceptor
    {
        public int FailOnSaveNumber { get; set; }
        public int SaveCount { get; private set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (++SaveCount == FailOnSaveNumber) throw new InvalidOperationException("Simulated failure before commit.");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Database : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        public KoochDbContext Context { get; }
        public FailAfterSave Failure { get; } = new();
        public ReservationCashbackEntitlementService Service => new(Context);

        public Database()
        {
            SqliteTestFunctions.RegisterLen(connection);
            connection.Open();
            Context = new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection).AddInterceptors(Failure).Options);
            Context.Database.EnsureCreated();
            Context.Users.Add(new User { Id = 1, FirstName = "Guest", LastName = "One" });
            Context.Destinations.Add(new Destination { Id = 1, Name = "City", Slug = "city" });
            Context.Properties.Add(new Property { Id = 1, OwnerId = 1, DestinationId = 1, Name = "Property", Slug = "property" });
            Context.RoomTypes.Add(new RoomType { Id = 1, PropertyId = 1, Name = "Room", Slug = "room", TotalInventory = 1 });
            Context.Reservations.Add(new Reservation
            {
                Id = 1, ClientId = 1, PropertyId = 1, RoomTypeId = 1, Currency = "IRR",
                ReservationNumber = "R-123456", Status = ReservationStatus.Paid, FinalAmount = 100m,
                CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2), AdultCount = 1
            });
            Context.SaveChanges();
            Context.ReservationCashbackEntitlements.Add(new ReservationCashbackEntitlement
            {
                Id = 1, ReservationId = 1, UserId = 1, PropertyId = 1, Currency = "IRR",
                GuestPayableSnapshot = 100m, EligibleBaseSnapshot = 100m, CashbackAmount = 10m,
                PolicySource = CashbackPolicySource.Global, CalculationMode = CashbackCalculationMode.Percentage,
                PercentageRateSnapshot = 10m, MaxCashbackPerReservationSnapshot = 50m,
                ExpiryDaysSnapshot = 30, EligibleAtUtc = Eligible
            });
            Context.SaveChanges();
            Context.ChangeTracker.Clear();
        }

        public void Dispose() { Context.Dispose(); connection.Dispose(); }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(Microsoft.EntityFrameworkCore.ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<WalletAccount>().Property(account => account.RowVersion).ValueGeneratedNever();
            builder.Entity<Reservation>().Property(reservation => reservation.RowVersion).ValueGeneratedNever();
        }
    }
}

public sealed class ReservationCashbackGrantSqlServerTests(SqlServerWalletDatabase database)
    : IClassFixture<SqlServerWalletDatabase>
{
    private static readonly DateTime Due = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);

    [SqlServerWalletFact]
    public async Task ConcurrentGrantsCreateOneCredit()
    {
        var (entitlementId, _) = await SeedAsync();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<ReservationCashbackEntitlement> Grant()
        {
            await started.Task;
            await using var context = database.NewContext();
            return await new ReservationCashbackEntitlementService(context).GrantAsync(entitlementId, Due);
        }
        var first = Grant();
        var second = Grant();
        started.SetResult();
        var results = await Task.WhenAll(first, second);
        await using var verify = database.NewContext();
        Assert.Equal(results[0].GrantedWalletEntryId, results[1].GrantedWalletEntryId);
        Assert.Equal(results[0].GrantedAtUtc, results[1].GrantedAtUtc);
        Assert.Single(await verify.WalletEntries.Where(entry => entry.WalletLot.SourceReference ==
            $"cashback:entitlement:{entitlementId}").ToListAsync());
    }

    [SqlServerWalletFact]
    public async Task GrantAndCancellationSerializeWithoutVoidCredit()
    {
        var (entitlementId, reservationId) = await SeedAsync();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task Grant()
        {
            await started.Task;
            await using var context = database.NewContext();
            try { await new ReservationCashbackEntitlementService(context).GrantAsync(entitlementId, Due); }
            catch (InvalidOperationException error) when (error.Message is
                "Only an ungranted Pending Cashback entitlement can be granted." or
                "Cancelled reservations cannot receive Cashback.") { }
        }
        async Task Cancel()
        {
            await started.Task;
            await using var context = database.NewContext();
            await using var transaction = await context.Database.BeginTransactionAsync();
            await BookingFundingLock.ForReservationAsync(context, reservationId, default);
            await context.Reservations.FromSqlInterpolated(
                $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
                .AsNoTracking().SingleAsync();
            var reservation = await context.Reservations.SingleAsync(row => row.Id == reservationId);
            reservation.Status = ReservationStatus.Cancelled;
            await new ReservationCashbackEntitlementService(context).VoidPendingForReservationAsync(reservationId);
            await context.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        var grant = Grant();
        var cancel = Cancel();
        started.SetResult();
        await Task.WhenAll(grant, cancel);
        await using var verify = database.NewContext();
        var entitlement = await verify.ReservationCashbackEntitlements.SingleAsync(row => row.Id == entitlementId);
        var credits = await verify.WalletEntries.Where(entry => entry.WalletLot.SourceReference ==
            $"cashback:entitlement:{entitlementId}").ToListAsync();
        Assert.Equal(ReservationStatus.Cancelled,
            (await verify.Reservations.SingleAsync(row => row.Id == reservationId)).Status);
        if (entitlement.Status == CashbackEntitlementStatus.Voided)
            Assert.Empty(credits);
        else
        {
            Assert.Equal(CashbackEntitlementStatus.Granted, entitlement.Status);
            Assert.Single(credits);
            Assert.Equal(credits[0].Id, entitlement.GrantedWalletEntryId);
        }
    }

    private async Task<(int EntitlementId, int ReservationId)> SeedAsync()
    {
        await using var context = database.NewContext();
        var suffix = Guid.NewGuid().ToString("N");
        var user = new User { FirstName = "Cashback", LastName = "Guest" };
        var destination = new Destination { Name = "Cashback City", Slug = $"cashback-city-{suffix}" };
        var property = new Property { Owner = user, Destination = destination, Name = "Cashback Property", Slug = $"cashback-property-{suffix}" };
        var room = new RoomType { Property = property, Name = "Room", Slug = $"cashback-room-{suffix}", TotalInventory = 1 };
        var reservation = new Reservation
        {
            Client = user, Property = property, RoomType = room, Currency = "IRR",
            Status = ReservationStatus.Paid, FinalAmount = 100m,
            CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2), AdultCount = 1
        };
        context.Reservations.Add(reservation);
        await context.SaveChangesAsync();
        var entitlement = new ReservationCashbackEntitlement
        {
            ReservationId = reservation.Id, UserId = user.Id, PropertyId = property.Id, Currency = "IRR",
            GuestPayableSnapshot = 100m, EligibleBaseSnapshot = 100m, CashbackAmount = 10m,
            PolicySource = CashbackPolicySource.Global, CalculationMode = CashbackCalculationMode.Percentage,
            PercentageRateSnapshot = 10m, MaxCashbackPerReservationSnapshot = 50m,
            ExpiryDaysSnapshot = 30, EligibleAtUtc = Due
        };
        context.ReservationCashbackEntitlements.Add(entitlement);
        await context.SaveChangesAsync();
        return (entitlement.Id, reservation.Id);
    }
}
