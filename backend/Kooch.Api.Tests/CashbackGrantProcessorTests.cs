using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.Wallet;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CashbackGrantProcessorTests
{
    private static readonly DateTime Now = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task DiscoversOnlyDuePendingIdsAtBoundaryInEligibilityThenIdOrder()
    {
        using var test = new Fixture();
        await test.SeedAsync((4, Now, CashbackEntitlementStatus.Pending),
            (2, Now.AddMinutes(-1), CashbackEntitlementStatus.Pending),
            (3, Now, CashbackEntitlementStatus.Pending),
            (1, Now.AddTicks(1), CashbackEntitlementStatus.Pending),
            (5, Now.AddMinutes(-2), CashbackEntitlementStatus.Voided),
            (6, Now.AddMinutes(-2), CashbackEntitlementStatus.Granted));

        var result = await test.Processor.ProcessDueBatchAsync(Now, 100, default);

        Assert.Equal(new[] { 2, 3, 4 }, test.Grants.Calls);
        Assert.Equal(3, result.CandidateCount);
        Assert.Equal(3, result.ProcessedCount);
    }

    [Fact]
    public async Task BatchLimitAndNoWorkAreSafe()
    {
        using var test = new Fixture();
        await test.SeedAsync((1, Now, CashbackEntitlementStatus.Pending),
            (2, Now, CashbackEntitlementStatus.Pending));
        var first = await test.Processor.ProcessDueBatchAsync(Now, 1, default);
        var empty = await test.Processor.ProcessDueBatchAsync(Now.AddDays(-1), 1, default);
        Assert.Equal(new[] { 1 }, test.Grants.Calls);
        Assert.Equal(1, first.CandidateCount);
        Assert.Equal(0, empty.CandidateCount);
    }

    [Fact]
    public async Task FailureDoesNotPreventNextCandidateAndRemainsRetryable()
    {
        using var test = new Fixture();
        await test.SeedAsync((1, Now, CashbackEntitlementStatus.Pending),
            (2, Now, CashbackEntitlementStatus.Pending));
        var fail = true;
        test.Grants.OnGrant = (id, _) =>
        {
            if (id == 1 && fail) throw new Exception("Transient failure");
            return Task.CompletedTask;
        };
        var first = await test.Processor.ProcessDueBatchAsync(Now, 2, default);
        Assert.Equal((1, 1), (first.FailedCount, first.ProcessedCount));
        Assert.Equal(new[] { 1, 2 }, test.Grants.Calls);
        fail = false;
        var retry = await test.Processor.ProcessDueBatchAsync(Now, 1, default);
        Assert.Equal(1, retry.ProcessedCount);
        Assert.Equal(new[] { 1, 2, 1 }, test.Grants.Calls);
    }

    [Theory]
    [InlineData("Only an ungranted Pending Cashback entitlement can be granted.")]
    [InlineData("Cancelled reservations cannot receive Cashback.")]
    [InlineData("Cashback entitlement is not yet due.")]
    public async Task StateChangeOrCancellationIsANormalSkip(string reason)
    {
        using var test = new Fixture();
        await test.SeedAsync((1, Now, CashbackEntitlementStatus.Pending),
            (2, Now, CashbackEntitlementStatus.Pending));
        test.Grants.OnGrant = (id, _) => id == 1
            ? Task.FromException(new InvalidOperationException(reason)) : Task.CompletedTask;
        var result = await test.Processor.ProcessDueBatchAsync(Now, 2, default);
        Assert.Equal((1, 1, 0), (result.SkippedCount, result.ProcessedCount, result.FailedCount));
        Assert.Equal(new[] { 1, 2 }, test.Grants.Calls);
    }

    [Fact]
    public async Task CancellationStopsBeforeFollowingCandidate()
    {
        using var test = new Fixture();
        await test.SeedAsync((1, Now, CashbackEntitlementStatus.Pending),
            (2, Now, CashbackEntitlementStatus.Pending));
        using var source = new CancellationTokenSource();
        test.Grants.OnGrant = (_, _) => { source.Cancel(); return Task.CompletedTask; };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            test.Processor.ProcessDueBatchAsync(Now, 2, source.Token));
        Assert.Equal(new[] { 1 }, test.Grants.Calls);
    }

    [Fact]
    public async Task DisabledWorkerDoesNotQueryOrGrantAndConfiguredBatchSizeIsUsed()
    {
        using var test = new Fixture();
        await test.SeedAsync((1, Now, CashbackEntitlementStatus.Pending),
            (2, Now, CashbackEntitlementStatus.Pending));
        var disabled = new CashbackGrantHostedService(test.Processor,
            Options.Create(new CashbackGrantProcessorOptions { Enabled = false }),
            new FixedTimeProvider(Now), NullLogger<CashbackGrantHostedService>.Instance);
        Assert.Null(await disabled.RunOnceAsync(default));
        Assert.Empty(test.Grants.Calls);

        var enabled = new CashbackGrantHostedService(test.Processor,
            Options.Create(new CashbackGrantProcessorOptions { BatchSize = 1 }),
            new FixedTimeProvider(Now), NullLogger<CashbackGrantHostedService>.Instance);
        Assert.Equal(1, (await enabled.RunOnceAsync(default))!.CandidateCount);
        Assert.Equal(new[] { 1 }, test.Grants.Calls);
    }

    [Fact]
    public async Task CandidateQueryFailureReturnsWithoutGrant()
    {
        var services = new ServiceCollection();
        services.AddScoped<KoochDbContext>(_ => throw new InvalidOperationException("DB unavailable"));
        using var provider = services.BuildServiceProvider();
        var processor = new CashbackGrantProcessor(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<CashbackGrantProcessor>.Instance);
        var result = await processor.ProcessDueBatchAsync(Now, 100, default);
        Assert.True(result.QueryFailed);
        Assert.Equal(0, result.CandidateCount);
    }

    [Fact]
    public async Task RealGrantUsesSnapshotAndRepeatedCycleDoesNotDoubleCredit()
    {
        using var test = new SqliteGrantFixture();
        var first = await test.Processor.ProcessDueBatchAsync(Now, 100, default);
        var second = await test.Processor.ProcessDueBatchAsync(Now, 100, default);
        await using var verify = test.NewContext();
        var entitlement = await verify.ReservationCashbackEntitlements.SingleAsync();
        var lot = await verify.WalletLots.SingleAsync();
        var entry = await verify.WalletEntries.SingleAsync();
        Assert.Equal((1, 1, 0), (first.CandidateCount, first.ProcessedCount, second.CandidateCount));
        Assert.Equal(CashbackEntitlementStatus.Granted, entitlement.Status);
        Assert.Equal(Now, entitlement.GrantedAtUtc);
        Assert.Equal((lot.Id, entry.Id), (entitlement.GrantedWalletLotId, entitlement.GrantedWalletEntryId));
        Assert.Equal(10m, entry.Amount);
        Assert.Equal(WalletSourceType.PromotionalCredit, lot.SourceType);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal(Now.AddDays(30), lot.ExpiresAtUtc);
    }

    [Fact]
    public async Task CancelledReservationCandidateIsSkippedWithoutWalletCredit()
    {
        using var test = new SqliteGrantFixture(cancelled: true);
        var result = await test.Processor.ProcessDueBatchAsync(Now, 100, default);
        await using var verify = test.NewContext();
        Assert.Equal((1, 0, 1), (result.CandidateCount, result.ProcessedCount, result.SkippedCount));
        Assert.Equal(CashbackEntitlementStatus.Pending,
            (await verify.ReservationCashbackEntitlements.SingleAsync()).Status);
        Assert.Empty(await verify.WalletLots.ToListAsync());
        Assert.Empty(await verify.WalletEntries.ToListAsync());
    }

    private sealed class Fixture : IDisposable
    {
        private readonly ServiceProvider provider;
        public FakeGrants Grants { get; } = new();
        public CashbackGrantProcessor Processor { get; }

        public Fixture()
        {
            var databaseName = $"cashback-processor-{Guid.NewGuid():N}";
            var services = new ServiceCollection();
            services.AddDbContext<KoochDbContext>(options => options.UseInMemoryDatabase(databaseName));
            services.AddSingleton<IReservationCashbackEntitlementService>(Grants);
            provider = services.BuildServiceProvider();
            Processor = new CashbackGrantProcessor(provider.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<CashbackGrantProcessor>.Instance);
        }

        public async Task SeedAsync(params (int Id, DateTime Eligible, CashbackEntitlementStatus Status)[] rows)
        {
            using var scope = provider.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            foreach (var row in rows)
                context.ReservationCashbackEntitlements.Add(new ReservationCashbackEntitlement
                {
                    Id = row.Id, ReservationId = row.Id, UserId = 1, PropertyId = 1,
                    Currency = "IRR", EligibleAtUtc = row.Eligible,
                    CashbackAmount = 10m, EligibleBaseSnapshot = 100m, GuestPayableSnapshot = 100m,
                    ExpiryDaysSnapshot = 30
                });
            await context.SaveChangesAsync();
            foreach (var row in rows.Where(row => row.Status != CashbackEntitlementStatus.Pending))
            {
                var entity = await context.ReservationCashbackEntitlements.FindAsync(row.Id);
                entity!.Status = row.Status;
                if (row.Status == CashbackEntitlementStatus.Granted)
                {
                    entity.GrantedAtUtc = Now;
                    entity.GrantedWalletLotId = 10;
                    entity.GrantedWalletEntryId = 10;
                }
            }
            await context.SaveChangesAsync();
        }

        public void Dispose() => provider.Dispose();
    }

    private sealed class FakeGrants : IReservationCashbackEntitlementService
    {
        public List<int> Calls { get; } = [];
        public Func<int, CancellationToken, Task>? OnGrant { get; set; }
        public decimal CalculateAmount(PendingCashbackEntitlementInput input) => throw new NotSupportedException();
        public Task<ReservationCashbackEntitlement?> CreatePendingAsync(PendingCashbackEntitlementInput input,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public async Task<ReservationCashbackEntitlement> GrantAsync(int entitlementId, DateTime nowUtc,
            CancellationToken cancellationToken = default)
        {
            Calls.Add(entitlementId);
            if (OnGrant != null) await OnGrant(entitlementId, cancellationToken);
            return new ReservationCashbackEntitlement { Id = entitlementId };
        }
    }

    private sealed class FixedTimeProvider(DateTime nowUtc) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(nowUtc);
    }

    private sealed class SqliteGrantFixture : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        private readonly DbContextOptions<KoochDbContext> options;
        private readonly ServiceProvider provider;
        public CashbackGrantProcessor Processor { get; }

        public SqliteGrantFixture(bool cancelled = false)
        {
            SqliteTestFunctions.RegisterLen(connection);
            connection.Open();
            options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
            using (var context = NewContext())
            {
                context.Database.EnsureCreated();
                context.Users.Add(new User { Id = 1, FirstName = "Guest", LastName = "One" });
                context.Destinations.Add(new Destination { Id = 1, Name = "City", Slug = "city" });
                context.Properties.Add(new Property
                    { Id = 1, OwnerId = 1, DestinationId = 1, Name = "Property", Slug = "property" });
                context.RoomTypes.Add(new RoomType
                    { Id = 1, PropertyId = 1, Name = "Room", Slug = "room", TotalInventory = 1 });
                context.Reservations.Add(new Reservation
                {
                    Id = 1, ClientId = 1, PropertyId = 1, RoomTypeId = 1, Currency = "IRR",
                    ReservationNumber = "R-123456",
                    Status = cancelled ? ReservationStatus.Cancelled : ReservationStatus.Paid,
                    FinalAmount = 100m, CheckInDate = new DateOnly(2026, 10, 1),
                    CheckOutDate = new DateOnly(2026, 10, 2), AdultCount = 1
                });
                context.SaveChanges();
                context.ReservationCashbackEntitlements.Add(new ReservationCashbackEntitlement
                {
                    Id = 1, ReservationId = 1, UserId = 1, PropertyId = 1, Currency = "IRR",
                    GuestPayableSnapshot = 100m, EligibleBaseSnapshot = 100m, CashbackAmount = 10m,
                    PolicySource = CashbackPolicySource.Global,
                    CalculationMode = CashbackCalculationMode.Percentage,
                    PercentageRateSnapshot = 10m, MaxCashbackPerReservationSnapshot = 50m,
                    ExpiryDaysSnapshot = 30, EligibleAtUtc = Now
                });
                context.SaveChanges();
            }
            var services = new ServiceCollection();
            services.AddScoped<KoochDbContext>(_ => NewContext());
            services.AddScoped<IReservationCashbackEntitlementService, ReservationCashbackEntitlementService>();
            provider = services.BuildServiceProvider();
            Processor = new CashbackGrantProcessor(provider.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<CashbackGrantProcessor>.Instance);
        }

        public KoochDbContext NewContext() => new SqliteGrantContext(options);

        public void Dispose() { provider.Dispose(); connection.Dispose(); }

        private sealed class SqliteGrantContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
        {
            protected override void OnModelCreating(ModelBuilder builder)
            {
                base.OnModelCreating(builder);
                builder.Entity<WalletAccount>().Property(account => account.RowVersion).ValueGeneratedNever();
                builder.Entity<Reservation>().Property(reservation => reservation.RowVersion).ValueGeneratedNever();
            }
        }
    }
}

public sealed class CashbackGrantProcessorSqlServerTests(SqlServerWalletDatabase database)
    : IClassFixture<SqlServerWalletDatabase>
{
    private static readonly DateTime Due = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);

    [SqlServerWalletFact]
    public async Task ConcurrentProcessorsDiscoverSameCandidateButCreateOneCredit()
    {
        int entitlementId;
        await using (var context = database.NewContext())
        {
            var suffix = Guid.NewGuid().ToString("N");
            var user = new User { FirstName = "Cashback", LastName = "Guest" };
            var destination = new Destination { Name = "Cashback City", Slug = $"cashback-city-{suffix}" };
            var property = new Property
                { Owner = user, Destination = destination, Name = "Cashback Property", Slug = $"cashback-property-{suffix}" };
            var room = new RoomType
                { Property = property, Name = "Room", Slug = $"cashback-room-{suffix}", TotalInventory = 1 };
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
            entitlementId = entitlement.Id;
        }

        var services = new ServiceCollection();
        services.AddScoped<KoochDbContext>(_ => database.NewContext());
        services.AddScoped<IReservationCashbackEntitlementService, ReservationCashbackEntitlementService>();
        using var provider = services.BuildServiceProvider();
        var processor = new CashbackGrantProcessor(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<CashbackGrantProcessor>.Instance);
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<CashbackGrantBatchResult> Run()
        {
            await start.Task;
            return await processor.ProcessDueBatchAsync(Due, 100, default);
        }
        var first = Run();
        var second = Run();
        start.SetResult();
        await Task.WhenAll(first, second);

        await using var verify = database.NewContext();
        var granted = await verify.ReservationCashbackEntitlements.SingleAsync(row => row.Id == entitlementId);
        var lots = await verify.WalletLots.Where(row => row.SourceReference ==
            $"cashback:entitlement:{entitlementId}").ToListAsync();
        var entries = await verify.WalletEntries.Where(row => row.WalletLot.SourceReference ==
            $"cashback:entitlement:{entitlementId}").ToListAsync();
        Assert.Equal(CashbackEntitlementStatus.Granted, granted.Status);
        Assert.NotNull(granted.GrantedAtUtc);
        Assert.Equal(10m, Assert.Single(entries).Amount);
        Assert.Equal(Assert.Single(lots).Id, granted.GrantedWalletLotId);
        Assert.Equal(entries[0].Id, granted.GrantedWalletEntryId);
    }
}
