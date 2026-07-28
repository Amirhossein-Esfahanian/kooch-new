using System.Data.Common;
using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Holidays;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class HolidayCalendarQueryServiceTests
{
    private static readonly DateOnly FirstDate = new(2026, 3, 21);
    private static readonly DateOnly FridayDate = new(2026, 3, 27);

    [Fact]
    public async Task GetDaysAsync_ReturnsOnlyHolidaysInsideRequestedRangeInDateOrder()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        context.HolidayCalendarDays.AddRange(
            CreateDay(FirstDate.AddDays(-2), false),
            CreateDay(FirstDate.AddDays(2), false),
            CreateDay(FirstDate, false));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var response = await CreateService(context).GetDaysAsync(FirstDate, FirstDate.AddDays(2));

        Assert.Equal([FirstDate, FirstDate.AddDays(2)], response.Days.Select(day => day.Date));
        Assert.All(response.Days, day => Assert.True(day.IsHoliday));
    }

    [Fact]
    public async Task GetDaysAsync_AppliesWeeklyOverride()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(FirstDate, false);
        day.Override = new HolidayCalendarDayOverride
        {
            IsWeeklyHoliday = true,
            IsOfficialHoliday = false
        };
        context.Add(day);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var returnedDay = Assert.Single((await CreateService(context)
            .GetDaysAsync(FirstDate, FirstDate)).Days);

        Assert.True(returnedDay.IsWeeklyHoliday);
        Assert.False(returnedDay.IsOfficialHoliday);
    }

    [Fact]
    public async Task GetDaysAsync_AppliesOfficialOverride()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(FridayDate, true);
        day.Override = new HolidayCalendarDayOverride
        {
            IsWeeklyHoliday = false,
            IsOfficialHoliday = true
        };
        context.Add(day);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var returnedDay = Assert.Single((await CreateService(context)
            .GetDaysAsync(FridayDate, FridayDate)).Days);

        Assert.False(returnedDay.IsWeeklyHoliday);
        Assert.True(returnedDay.IsOfficialHoliday);
    }

    [Fact]
    public async Task GetDaysAsync_OmitsDayWhenOverrideRemovesBothHolidayFlags()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(FirstDate, false);
        day.Override = new HolidayCalendarDayOverride
        {
            IsWeeklyHoliday = false,
            IsOfficialHoliday = false
        };
        context.Add(day);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var response = await CreateService(context).GetDaysAsync(FirstDate, FirstDate);

        Assert.Empty(response.Days);
    }

    [Fact]
    public async Task GetDaysAsync_RejectsEffectiveBothTrueClassification()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(FirstDate, false);
        day.Override = new HolidayCalendarDayOverride { IsWeeklyHoliday = true };
        context.Add(day);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateService(context).GetDaysAsync(FirstDate, FirstDate));

        Assert.Equal("Holiday calendar data contains an invalid effective classification.", exception.Message);
    }

    [Fact]
    public async Task GetDaysAsync_MergesTrimsDeduplicatesAndOrdersProviderAndManualOccasions()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(FirstDate, false);
        day.Occasions.Add(CreateOccasion(" Zulu ", "zulu", HolidayCalendarOccasionSource.Provider));
        day.Occasions.Add(CreateOccasion("alpha", "alpha", HolidayCalendarOccasionSource.Provider));
        day.Occasions.Add(CreateOccasion(" Alpha ", "alpha", HolidayCalendarOccasionSource.Manual));
        day.Occasions.Add(CreateOccasion(" Beta ", "beta", HolidayCalendarOccasionSource.Manual));
        context.Add(day);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var returnedDay = Assert.Single((await CreateService(context)
            .GetDaysAsync(FirstDate, FirstDate)).Days);

        Assert.Equal(["Alpha", "Beta", "Zulu"], returnedDay.OccasionTitles);
    }

    [Fact]
    public async Task GetDaysAsync_ReturnsOrdinaryFridayWithEmptyOccasionTitles()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        context.Add(CreateDay(FridayDate, true));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var returnedDay = Assert.Single((await CreateService(context)
            .GetDaysAsync(FridayDate, FridayDate)).Days);

        Assert.True(returnedDay.IsWeeklyHoliday);
        Assert.Empty(returnedDay.OccasionTitles);
    }

    [Fact]
    public async Task GetDaysAsync_UsesMatchingSuccessfulSyncStateForCoverage()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var successfulAt = new DateTime(2026, 7, 28, 6, 0, 0, DateTimeKind.Utc);
        context.Add(CreateSyncState(1405, 1407, successfulAt));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var response = await CreateService(context).GetDaysAsync(FirstDate, FirstDate.AddDays(1));

        Assert.True(response.IsRangeFullyCovered);
        Assert.Equal(1405, response.CoveredSolarYearFrom);
        Assert.Equal(1407, response.CoveredSolarYearTo);
        Assert.Equal(successfulAt, response.LastSuccessfulSyncAtUtc);
    }

    [Fact]
    public async Task GetDaysAsync_MissingSyncStateProducesIncompleteCoverage()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();

        var response = await CreateService(context).GetDaysAsync(FirstDate, FirstDate);

        Assert.False(response.IsRangeFullyCovered);
        Assert.Null(response.CoveredSolarYearFrom);
        Assert.Null(response.CoveredSolarYearTo);
        Assert.Null(response.LastSuccessfulSyncAtUtc);
    }

    [Fact]
    public async Task GetDaysAsync_RangeOutsideSuccessfulSolarYearsProducesIncompleteCoverage()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        context.Add(CreateSyncState(1405, 1407, DateTime.UtcNow));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var outsideDate = DateOnly.FromDateTime(
            new PersianCalendar().ToDateTime(1408, 1, 1, 0, 0, 0, 0));

        var response = await CreateService(context).GetDaysAsync(outsideDate, outsideDate);

        Assert.False(response.IsRangeFullyCovered);
        Assert.Equal(1405, response.CoveredSolarYearFrom);
        Assert.Equal(1407, response.CoveredSolarYearTo);
    }

    [Fact]
    public async Task GetDaysAsync_UsesTwoNoTrackingQueriesWithoutProviderDependencies()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        context.Add(CreateDay(FirstDate, false));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        database.CommandCounter.Reset();

        await CreateService(context).GetDaysAsync(FirstDate, FirstDate);

        Assert.Equal(2, database.CommandCounter.ReaderCommandCount);
        Assert.Empty(context.ChangeTracker.Entries());
    }

    private static HolidayCalendarQueryService CreateService(KoochDbContext context) =>
        new(
            context,
            Options.Create(new HolidayCalendarSynchronizationOptions { ProviderName = "PNLdev" }),
            NullLogger<HolidayCalendarQueryService>.Instance);

    private static HolidayCalendarDay CreateDay(DateOnly date, bool isWeeklyHoliday)
    {
        var calendar = new PersianCalendar();
        var dateTime = date.ToDateTime(TimeOnly.MinValue);
        return new HolidayCalendarDay
        {
            GregorianDate = date,
            SolarYear = calendar.GetYear(dateTime),
            SolarMonth = calendar.GetMonth(dateTime),
            SolarDay = calendar.GetDayOfMonth(dateTime),
            DayOfWeek = date.DayOfWeek,
            IsWeeklyHoliday = isWeeklyHoliday,
            IsOfficialHoliday = !isWeeklyHoliday,
            ProviderName = "PNLdev",
            SourceSolarYear = calendar.GetYear(dateTime),
            LastProviderSyncAtUtc = new DateTime(2026, 7, 28, 6, 0, 0, DateTimeKind.Utc)
        };
    }

    private static HolidayCalendarOccasion CreateOccasion(
        string title,
        string normalizedTitle,
        HolidayCalendarOccasionSource source) => new()
        {
            Title = title,
            NormalizedTitle = normalizedTitle,
            Source = source
        };

    private static HolidayCalendarSyncState CreateSyncState(
        int from,
        int to,
        DateTime successfulAtUtc) => new()
        {
            ProviderName = "PNLdev",
            LastAttemptAtUtc = successfulAtUtc,
            LastSuccessfulSyncAtUtc = successfulAtUtc,
            LastSuccessfulSolarYearFrom = from,
            LastSuccessfulSolarYearTo = to,
            LastResponseHash = "present",
            RowVersion = []
        };

    private sealed class SqliteTestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public CommandCounter CommandCounter { get; } = new();

        public static async Task<SqliteTestDatabase> CreateAsync()
        {
            var database = new SqliteTestDatabase();
            await database.connection.OpenAsync();
            await using var context = database.CreateContext();
            await context.Database.EnsureCreatedAsync();
            database.CommandCounter.Reset();
            return database;
        }

        public KoochDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .AddInterceptors(CommandCounter)
                .Options;
            return new SqliteKoochDbContext(options);
        }

        public async ValueTask DisposeAsync() => await connection.DisposeAsync();
    }

    private sealed class SqliteKoochDbContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<HolidayCalendarSyncState>()
                .Property(state => state.RowVersion)
                .ValueGeneratedNever();
        }
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int ReaderCommandCount { get; private set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            ReaderCommandCount++;
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            ReaderCommandCount++;
            return ValueTask.FromResult(result);
        }

        public void Reset() => ReaderCommandCount = 0;
    }
}
