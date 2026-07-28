using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Holidays;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class HolidayCalendarSynchronizationServiceTests
{
    private static readonly DateTimeOffset FirstAttempt = new(2026, 7, 28, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task SyncWindow_SavesThreeYearsAndSuccessStateAtomically()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        await using var context = database.CreateContext();
        var service = CreateService(context, provider, FirstAttempt);

        var result = await service.SyncWindowAsync(1405, 2);

        Assert.True(result.Succeeded);
        Assert.Equal(6, result.InsertedDayCount);
        Assert.Equal(3, result.InsertedProviderOccasionCount);
        Assert.Equal([1405, 1406, 1407], provider.RequestedYears);
        var days = await context.HolidayCalendarDays.Include(day => day.Occasions).ToListAsync();
        Assert.Equal(6, days.Count);
        Assert.All(days.Where(day => day.IsWeeklyHoliday), day => Assert.Empty(day.Occasions));
        Assert.All(days.Where(day => day.IsOfficialHoliday), day =>
            Assert.Single(day.Occasions, occasion => occasion.Source == HolidayCalendarOccasionSource.Provider));
        var state = await context.HolidayCalendarSyncStates.SingleAsync();
        Assert.Equal(FirstAttempt.UtcDateTime, state.LastAttemptAtUtc);
        Assert.Equal(FirstAttempt.UtcDateTime, state.LastSuccessfulSyncAtUtc);
        Assert.Equal(1405, state.LastSuccessfulSolarYearFrom);
        Assert.Equal(1407, state.LastSuccessfulSolarYearTo);
        Assert.NotNull(state.LastResponseHash);
        Assert.Equal(64, state.LastResponseHash!.Length);
        Assert.Null(state.LastErrorSummary);
    }

    [Fact]
    public async Task SyncWindow_ProviderFailurePreservesHolidaySnapshotAndPreviousSuccessState()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await SeedSuccessfulSnapshotAsync(database);
        var secondAttempt = FirstAttempt.AddHours(1);
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        provider.Failures[1406] = new HolidayProviderException(
            HolidayProviderFailureKind.NetworkOrTimeout,
            "sensitive provider detail");
        await using var context = database.CreateContext();
        var before = await context.HolidayCalendarDays.AsNoTracking().OrderBy(day => day.Id).ToListAsync();
        var previousState = await context.HolidayCalendarSyncStates.AsNoTracking().SingleAsync();

        var result = await CreateService(context, provider, secondAttempt).SyncWindowAsync(1405, 2);

        Assert.False(result.Succeeded);
        Assert.Equal(HolidayCalendarSynchronizationFailureCategory.Provider, result.FailureCategory);
        Assert.DoesNotContain("sensitive", result.ErrorSummary, StringComparison.OrdinalIgnoreCase);
        var after = await context.HolidayCalendarDays.AsNoTracking().OrderBy(day => day.Id).ToListAsync();
        Assert.Equal(before.Select(day => day.GregorianDate), after.Select(day => day.GregorianDate));
        var state = await context.HolidayCalendarSyncStates.AsNoTracking().SingleAsync();
        Assert.Equal(secondAttempt.UtcDateTime, state.LastAttemptAtUtc);
        Assert.Equal(previousState.LastSuccessfulSyncAtUtc, state.LastSuccessfulSyncAtUtc);
        Assert.Equal(previousState.LastResponseHash, state.LastResponseHash);
        Assert.NotNull(state.LastErrorSummary);
    }

    [Fact]
    public async Task SyncWindow_ValidationFailureWritesNoHolidayChanges()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        var validDay = CreateOfficialHoliday(1406, "Occasion");
        provider.Years[1406] = CreateYear(1406, validDay, validDay);
        await using var context = database.CreateContext();

        var result = await CreateService(context, provider, FirstAttempt).SyncWindowAsync(1405, 2);

        Assert.False(result.Succeeded);
        Assert.Equal(HolidayCalendarSynchronizationFailureCategory.Validation, result.FailureCategory);
        Assert.Empty(await context.HolidayCalendarDays.ToListAsync());
        Assert.NotNull((await context.HolidayCalendarSyncStates.SingleAsync()).LastErrorSummary);
    }

    [Fact]
    public async Task SyncWindow_RepeatedSnapshotIsIdempotentAndHashIsDeterministic()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        await using var firstContext = database.CreateContext();
        var first = await CreateService(firstContext, provider, FirstAttempt).SyncWindowAsync(1405, 2);
        var firstHash = (await firstContext.HolidayCalendarSyncStates.AsNoTracking().SingleAsync()).LastResponseHash;

        await using var secondContext = database.CreateContext();
        var second = await CreateService(secondContext, provider, FirstAttempt.AddDays(1)).SyncWindowAsync(1405, 2);
        var secondHash = (await secondContext.HolidayCalendarSyncStates.AsNoTracking().SingleAsync()).LastResponseHash;

        Assert.True(first.Succeeded);
        Assert.True(second.Succeeded);
        Assert.Equal(0, second.InsertedDayCount);
        Assert.Equal(0, second.UpdatedDayCount);
        Assert.Equal(0, second.InsertedProviderOccasionCount);
        Assert.Equal(0, second.RemovedOrReplacedProviderOccasionCount);
        Assert.Equal(firstHash, secondHash);
        Assert.Equal(6, await secondContext.HolidayCalendarDays.CountAsync());
        Assert.Equal(3, await secondContext.HolidayCalendarOccasions.CountAsync());
    }

    [Fact]
    public async Task SyncWindow_ReconcilesProviderDataAndLeavesHistoricalYearsUntouched()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await SeedSuccessfulSnapshotAsync(database);
        await using (var setup = database.CreateContext())
        {
            setup.HolidayCalendarDays.Add(CreatePersistedDay(CreateOfficialHoliday(1404, "Historical"), FirstAttempt.UtcDateTime));
            await setup.SaveChangesAsync();
        }

        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        var retained = CreateOfficialHoliday(1405, "Changed title");
        var added = CreateOfficialHoliday(1405, "Added", startSolarDay: retained.SolarDay + 1);
        provider.Years[1405] = CreateYear(1405, retained, added);
        await using var context = database.CreateContext();

        var result = await CreateService(context, provider, FirstAttempt.AddDays(1)).SyncWindowAsync(1405, 2);

        Assert.True(result.Succeeded);
        Assert.Equal(1, result.InsertedDayCount);
        Assert.True(result.RemovedObsoleteProviderHolidayCount >= 1);
        Assert.Contains(await context.HolidayCalendarDays.ToListAsync(), day => day.SourceSolarYear == 1404);
        var updated = await context.HolidayCalendarDays.Include(day => day.Occasions)
            .SingleAsync(day => day.GregorianDate == retained.Date);
        Assert.Single(updated.Occasions);
        Assert.Equal("Changed title", updated.Occasions.Single().Title);
    }

    [Fact]
    public async Task SyncWindow_PreservesManualOverrideAndOccasionOnObsoleteDay()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await SeedSuccessfulSnapshotAsync(database);
        DateOnly obsoleteDate;
        await using (var setup = database.CreateContext())
        {
            var day = await setup.HolidayCalendarDays.Include(item => item.Occasions)
                .FirstAsync(item => item.SourceSolarYear == 1405 && item.IsOfficialHoliday);
            obsoleteDate = day.GregorianDate;
            day.Override = new HolidayCalendarDayOverride { IsOfficialHoliday = true, Note = "Manual" };
            day.Occasions.Add(new HolidayCalendarOccasion
            {
                Title = "Manual occasion",
                NormalizedTitle = "manual occasion",
                Source = HolidayCalendarOccasionSource.Manual
            });
            await setup.SaveChangesAsync();
        }

        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        provider.Years[1405] = CreateYear(1405, CreateWeeklyHoliday(1405));
        await using var context = database.CreateContext();
        var result = await CreateService(context, provider, FirstAttempt.AddDays(1)).SyncWindowAsync(1405, 2);

        Assert.True(result.Succeeded);
        Assert.Equal(1, result.PreservedObsoleteProviderHolidayCount);
        var preserved = await context.HolidayCalendarDays.Include(day => day.Override).Include(day => day.Occasions)
            .SingleAsync(day => day.GregorianDate == obsoleteDate);
        Assert.NotNull(preserved.Override);
        Assert.Single(preserved.Occasions);
        Assert.Equal(HolidayCalendarOccasionSource.Manual, preserved.Occasions.Single().Source);
    }

    [Fact]
    public async Task SyncWindow_DatabaseFailureRollsBackHolidayChanges()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        await using var context = database.CreateFailingContext();

        var result = await CreateService(context, provider, FirstAttempt).SyncWindowAsync(1405, 2);

        Assert.False(result.Succeeded);
        Assert.Equal(HolidayCalendarSynchronizationFailureCategory.Database, result.FailureCategory);
        await using var verification = database.CreateContext();
        Assert.Empty(await verification.HolidayCalendarDays.ToListAsync());
    }

    [Fact]
    public async Task SyncWindow_CancellationDuringFetchPropagatesAndWritesNothing()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        await using var context = database.CreateContext();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateService(context, provider, FirstAttempt).SyncWindowAsync(1405, 2, cancellation.Token));

        Assert.Empty(await context.HolidayCalendarDays.ToListAsync());
        Assert.Empty(await context.HolidayCalendarSyncStates.ToListAsync());
    }

    [Fact]
    public async Task SyncWindow_CancellationInsideProviderFetchPropagatesAndWritesNothing()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        using var cancellation = new CancellationTokenSource();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        provider.CancellationSource = cancellation;
        provider.CancelDuringFetchYear = 1406;
        await using var context = database.CreateContext();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateService(context, provider, FirstAttempt).SyncWindowAsync(1405, 2, cancellation.Token));

        Assert.Empty(await context.HolidayCalendarDays.ToListAsync());
        Assert.Empty(await context.HolidayCalendarSyncStates.ToListAsync());
    }

    [Fact]
    public async Task SyncWindow_CancellationAfterFetchBeforeWritePropagatesAndWritesNothing()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        using var cancellation = new CancellationTokenSource();
        var provider = FakeProvider.WithDefaultYears(1405, 1406, 1407);
        provider.CancellationSource = cancellation;
        provider.CancelAfterFetchYear = 1407;
        await using var context = database.CreateContext();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateService(context, provider, FirstAttempt).SyncWindowAsync(1405, 2, cancellation.Token));

        Assert.Empty(await context.HolidayCalendarDays.ToListAsync());
        Assert.Empty(await context.HolidayCalendarSyncStates.ToListAsync());
    }

    private static HolidayCalendarSynchronizationService CreateService(
        KoochDbContext context,
        IHolidayProvider provider,
        DateTimeOffset now) => new(
        context,
        provider,
        Options.Create(new HolidayCalendarSynchronizationOptions
        {
            Enabled = true,
            ProviderName = "PNLdev"
        }),
        NullLogger<HolidayCalendarSynchronizationService>.Instance,
        new FixedTimeProvider(now));

    private static async Task SeedSuccessfulSnapshotAsync(SqliteTestDatabase database)
    {
        await using var context = database.CreateContext();
        var result = await CreateService(
            context,
            FakeProvider.WithDefaultYears(1405, 1406, 1407),
            FirstAttempt).SyncWindowAsync(1405, 2);
        Assert.True(result.Succeeded);
    }

    private static HolidayProviderYear CreateYear(int solarYear, params HolidayProviderDay[] holidays) =>
        new("PNLdev", solarYear, solarYear, holidays);

    private static HolidayProviderDay CreateWeeklyHoliday(int solarYear)
    {
        for (var day = 1; day <= 31; day++)
        {
            var date = GregorianDate(solarYear, 1, day);
            if (date.DayOfWeek == DayOfWeek.Friday)
            {
                return new HolidayProviderDay(date, solarYear, 1, day, DayOfWeek.Friday, true, false, []);
            }
        }

        throw new InvalidOperationException("No Friday was found.");
    }

    private static HolidayProviderDay CreateOfficialHoliday(
        int solarYear,
        string title,
        int startSolarDay = 1)
    {
        for (var day = startSolarDay; day <= 31; day++)
        {
            var date = GregorianDate(solarYear, 1, day);
            if (date.DayOfWeek != DayOfWeek.Friday)
            {
                return new HolidayProviderDay(
                    date, solarYear, 1, day, date.DayOfWeek, false, true, [title]);
            }
        }

        throw new InvalidOperationException("No non-Friday date was found.");
    }

    private static DateOnly GregorianDate(int solarYear, int solarMonth, int solarDay) =>
        DateOnly.FromDateTime(new PersianCalendar().ToDateTime(solarYear, solarMonth, solarDay, 0, 0, 0, 0));

    private static HolidayCalendarDay CreatePersistedDay(HolidayProviderDay providerDay, DateTime syncedAt)
    {
        var day = new HolidayCalendarDay
        {
            GregorianDate = providerDay.Date,
            SolarYear = providerDay.SolarYear,
            SolarMonth = providerDay.SolarMonth,
            SolarDay = providerDay.SolarDay,
            DayOfWeek = providerDay.DayOfWeek,
            IsWeeklyHoliday = providerDay.IsWeeklyHoliday,
            IsOfficialHoliday = providerDay.IsOfficialHoliday,
            ProviderName = "PNLdev",
            SourceSolarYear = providerDay.SolarYear,
            LastProviderSyncAtUtc = syncedAt
        };
        foreach (var title in providerDay.OccasionTitles)
        {
            day.Occasions.Add(new HolidayCalendarOccasion
            {
                Title = title,
                NormalizedTitle = HolidayCalendarSnapshotValidator.NormalizeTitle(title),
                Source = HolidayCalendarOccasionSource.Provider
            });
        }

        return day;
    }

    private sealed class FakeProvider : IHolidayProvider
    {
        public Dictionary<int, HolidayProviderYear> Years { get; } = [];
        public Dictionary<int, HolidayProviderException> Failures { get; } = [];
        public List<int> RequestedYears { get; } = [];
        public CancellationTokenSource? CancellationSource { get; set; }
        public int? CancelDuringFetchYear { get; set; }
        public int? CancelAfterFetchYear { get; set; }

        public static FakeProvider WithDefaultYears(params int[] solarYears)
        {
            var provider = new FakeProvider();
            foreach (var year in solarYears)
            {
                provider.Years[year] = CreateYear(
                    year,
                    CreateWeeklyHoliday(year),
                    CreateOfficialHoliday(year, $"Occasion {year}"));
            }

            return provider;
        }

        public Task<HolidayProviderYear> FetchYearAsync(int solarHijriYear, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RequestedYears.Add(solarHijriYear);
            if (CancelDuringFetchYear == solarHijriYear)
            {
                CancellationSource!.Cancel();
                cancellationToken.ThrowIfCancellationRequested();
            }

            if (Failures.TryGetValue(solarHijriYear, out var exception))
            {
                throw exception;
            }

            var year = Years[solarHijriYear];
            if (CancelAfterFetchYear == solarHijriYear)
            {
                CancellationSource!.Cancel();
            }

            return Task.FromResult(year);
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class SqliteTestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public static async Task<SqliteTestDatabase> CreateAsync()
        {
            var database = new SqliteTestDatabase();
            await database.connection.OpenAsync();
            await using var context = database.CreateContext();
            await context.Database.EnsureCreatedAsync();
            return database;
        }

        public KoochDbContext CreateContext() => new SqliteKoochDbContext(CreateOptions());

        public KoochDbContext CreateFailingContext() => new FailOnceKoochDbContext(CreateOptions());

        private DbContextOptions<KoochDbContext> CreateOptions() =>
            new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;

        public async ValueTask DisposeAsync() => await connection.DisposeAsync();
    }

    private class SqliteKoochDbContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<HolidayCalendarSyncState>()
                .Property(state => state.RowVersion)
                .ValueGeneratedNever();
        }
    }

    private sealed class FailOnceKoochDbContext(DbContextOptions<KoochDbContext> options) : SqliteKoochDbContext(options)
    {
        private bool shouldFail = true;

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (shouldFail)
            {
                shouldFail = false;
                throw new DbUpdateException("Simulated write failure.");
            }

            return base.SaveChangesAsync(cancellationToken);
        }
    }
}
