using System.Globalization;
using System.Reflection;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingNumberGenerationTests
{
    [Fact]
    public async Task StandaloneCreation_PersistsOpaqueReferenceWithInternalIdentityUnchanged()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var context = harness.DbContext;
        for (var day = harness.CheckIn; day < harness.CheckOut; day = day.AddDays(1))
            context.RoomDailyPrices.Add(new RoomDailyPrice
            {
                RoomTypeId = 20, Date = day, GuestType = PricingGuestType.Iranian, BasePrice = 100
            });
        await context.SaveChangesAsync();
        var service = new ReservationService(context,
            new ReservationAvailabilityService(context, harness.EffectiveAvailability),
            new StubReservationPricingService(), new ReservationNumberGenerator(context),
            new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
            harness.AuditLogService, new StubPermissionService(true),
            new StubPropertyAuthorizationService(true), new ReservationStatusWorkflow(),
            harness.EffectiveAvailability, new TestHostEnvironment());

        var result = await service.CreateAsync(new ReservationCreateRequest
        {
            PropertyId = 10, RoomId = 30, GuestId = 40, Adults = 2,
            CheckInDate = harness.CheckIn, CheckOutDate = harness.CheckOut
        }, harness.SuperAdmin);

        context.ChangeTracker.Clear();
        var reservation = await context.Reservations.SingleAsync();
        Assert.True(reservation.Id > 0);
        Assert.Equal(result.Id, reservation.Id);
        Assert.Equal(result.ReservationNumber, reservation.ReservationNumber);
        Assert.Matches("^R-[0-9]{6}$", reservation.ReservationNumber!);
    }

    [Fact]
    public async Task ReservationNumbers_AreOpaqueSixDigitReferences()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        var numbers = await new ReservationNumberGenerator(context)
            .GenerateBatchAsync(200, new DateTime(2042, 7, 8));
        Assert.Equal(200, numbers.Distinct().Count());
        Assert.All(numbers, number =>
        {
            Assert.Matches("^R-[0-9]{6}$", number);
            Assert.InRange(int.Parse(number[2..], CultureInfo.InvariantCulture), 100000, 999999);
            Assert.DoesNotContain("KCH", number);
        });
    }

    [Fact]
    public async Task Generation_IgnoresDateAndDatabaseIdentityAndPreservesLegacyNumbers()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        context.Reservations.Add(new Reservation { Id = 876543, ReservationNumber = "KCH-20400203-000004" });
        await context.SaveChangesAsync();
        var generator = new CandidateGenerator(context, 123456);
        Assert.Equal("R-123456", await generator.GenerateAsync(new DateTime(2040, 2, 3)));
        Assert.Equal("R-123456", await generator.GenerateAsync(new DateTime(2050, 1, 1)));
        Assert.Equal("KCH-20400203-000004", (await context.Reservations.SingleAsync()).ReservationNumber);
    }

    [Fact]
    public async Task Generation_RetriesPersistedSoftDeletedTrackedAndBatchCollisions()
    {
        var options = CreateInMemoryOptions();
        await using (var setup = new KoochDbContext(options))
        {
            setup.Reservations.AddRange(
                new Reservation { ReservationNumber = "R-100000" },
                new Reservation { ReservationNumber = "R-200000", IsDeleted = true });
            await setup.SaveChangesAsync();
        }
        await using var context = new KoochDbContext(options);
        context.Reservations.Add(new Reservation { ReservationNumber = "R-300000" });
        var generator = new CandidateGenerator(context, 100000, 200000, 300000, 400000, 400000, 999999);
        Assert.Equal(new[] { "R-400000", "R-999999" }, await generator.GenerateBatchAsync(2));
        Assert.Equal(6, generator.Calls);
    }

    [Fact]
    public async Task Generation_FailsAfterBoundedCollisions()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        context.Reservations.Add(new Reservation { ReservationNumber = "R-123456" });
        var generator = new CandidateGenerator(context, 123456);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => generator.GenerateAsync());
        Assert.Contains("100 attempts", error.Message);
        Assert.Equal(100, generator.Calls);
    }

    [Fact]
    public async Task ReservationNumberBatch_RejectsAnInvalidCount()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            new ReservationNumberGenerator(context).GenerateBatchAsync(0));
    }

    [Theory]
    [InlineData(2601)]
    [InlineData(2627)]
    public async Task Save_RetriesOnlyNumberCollisionAndRollsBackPartialWrites(int sqlNumber)
    {
        await using var context = await CreateSaveContextAsync(sqlNumber, "IX_Reservations_ReservationNumber", 1);
        await using var transaction = await context.Database.BeginTransactionAsync();
        var reservation = new Reservation { ReservationNumber = "R-111111" };
        context.Reservations.Add(reservation);
        var generator = new CandidateGenerator(context, 583214);

        await generator.SaveWithReservationNumberRetryAsync(context);

        Assert.Equal(2, context.Attempts);
        Assert.Equal("R-583214", reservation.ReservationNumber);
        Assert.Equal(1, await context.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM AttemptWrites").SingleAsync());
    }

    [Fact]
    public async Task DatabaseUniqueIndex_RejectsTwoCreatorsThatSelectedTheSameReference()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var first = new ReservationConstraintContext(options);
        await first.Database.EnsureCreatedAsync();
        await first.Database.ExecuteSqlRawAsync("PRAGMA foreign_keys = OFF");
        await using var second = new ReservationConstraintContext(options);
        var firstNumber = await new CandidateGenerator(first, 583214).GenerateAsync();
        var secondNumber = await new CandidateGenerator(second, 583214).GenerateAsync();
        first.Reservations.Add(new Reservation { ReservationNumber = firstNumber });
        second.Reservations.Add(new Reservation { ReservationNumber = secondNumber });

        await first.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => second.SaveChangesAsync());
        Assert.Contains("Reservations.ReservationNumber", error.InnerException!.Message);
        Assert.Equal(1, await first.Reservations.CountAsync());
    }

    [Fact]
    public async Task Save_FailsExplicitlyAfterFiveCollisions()
    {
        await using var context = await CreateSaveContextAsync(2601, "IX_Reservations_ReservationNumber", 10);
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.Reservations.Add(new Reservation { ReservationNumber = "R-111111" });
        var generator = new CandidateGenerator(context, 200000, 300000, 400000, 500000);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            generator.SaveWithReservationNumberRetryAsync(context));
        Assert.Contains("5 attempts", error.Message);
        Assert.IsType<DbUpdateException>(error.InnerException);
        Assert.Equal(5, context.Attempts);
        Assert.Equal(0, await context.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM AttemptWrites").SingleAsync());
    }

    [Theory]
    [InlineData(2601, "IX_BookingSessions_SessionCode")]
    [InlineData(547, "IX_Reservations_ReservationNumber")]
    [InlineData(1205, "IX_Reservations_ReservationNumber")]
    [InlineData(2601, "IX_Reservations_ReservationNumber_Other")]
    public async Task Save_UnrelatedDatabaseErrorsAreNotRetried(int sqlNumber, string index)
    {
        await using var context = await CreateSaveContextAsync(sqlNumber, index, 1);
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.Reservations.Add(new Reservation { ReservationNumber = "R-111111" });
        var generator = new CandidateGenerator(context, 583214);
        await Assert.ThrowsAsync<DbUpdateException>(() => generator.SaveWithReservationNumberRetryAsync(context));
        Assert.Equal(1, context.Attempts);
        Assert.Equal(0, generator.Calls);
    }

    [Fact]
    public void SessionCodes_ConcurrentGenerationProducesUniqueFixedLengthCodes()
    {
        var generator = new BookingSessionCodeGenerator();
        var codes = new string[2_000];
        Parallel.For(0, codes.Length, index => codes[index] = generator.Generate());
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.All(codes, code => Assert.Matches("^KCH-S-[0-9A-F]{26}$", code));
    }

    private static DbContextOptions<KoochDbContext> CreateInMemoryOptions() =>
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"booking-number-generation-{Guid.NewGuid():N}").Options;

    private sealed class CandidateGenerator(KoochDbContext context, params int[] candidates)
        : ReservationNumberGenerator(context)
    {
        public int Calls { get; private set; }
        protected override int NextNumber() => candidates[Math.Min(Calls++, candidates.Length - 1)];
    }

    private sealed class ReservationConstraintContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            // SQLite does not generate SQL Server rowversion values.
            modelBuilder.Entity<Reservation>().Property(reservation => reservation.RowVersion).ValueGeneratedNever();
        }
    }

    private static async Task<FailingSaveContext> CreateSaveContextAsync(int sqlNumber, string index, int failures)
    {
        var context = new FailingSaveContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:").Options, sqlNumber, index, failures);
        await context.Database.OpenConnectionAsync();
        await context.Database.EnsureCreatedAsync();
        await context.Database.ExecuteSqlRawAsync("CREATE TABLE AttemptWrites (Id INTEGER)");
        return context;
    }

    // Inject SQL Server's actual exception type while exercising real relational savepoints.
    private sealed class FailingSaveContext(
        DbContextOptions<KoochDbContext> options, int sqlNumber, string index, int failures)
        : KoochDbContext(options)
    {
        public int Attempts { get; private set; }
        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            Attempts++;
            await Database.ExecuteSqlRawAsync("INSERT INTO AttemptWrites VALUES (1)", cancellationToken);
            if (Attempts <= failures)
                throw new DbUpdateException("Save failed", CreateSqlException(sqlNumber, index));
            return 1;
        }
    }

    private static SqlException CreateSqlException(int number, string index)
    {
        var errorConstructor = typeof(SqlError).GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic)
            .Single(constructor => constructor.GetParameters().Length == 9);
        var error = (SqlError)errorConstructor.Invoke(
            new object?[] { number, (byte)1, (byte)14, "server", $"Violation of unique index '{index}'.", "", 1, (uint)0, null });
        var collection = (SqlErrorCollection)Activator.CreateInstance(typeof(SqlErrorCollection), nonPublic: true)!;
        typeof(SqlErrorCollection).GetMethod("Add", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(collection, [error]);
        return (SqlException)typeof(SqlException).GetMethod("CreateException",
            BindingFlags.Static | BindingFlags.NonPublic, null,
            [typeof(SqlErrorCollection), typeof(string)], null)!.Invoke(null, [collection, "16.0"])!;
    }
}
