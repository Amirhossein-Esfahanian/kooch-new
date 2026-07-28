using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class HolidayCalendarPersistenceTests
{
    [Fact]
    public async Task GregorianDate_MustBeUnique()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var date = new DateOnly(2026, 3, 21);

        await using (var setupContext = database.CreateContext())
        {
            setupContext.HolidayCalendarDays.Add(CreateDay(date, 1405, 1, 1));
            await setupContext.SaveChangesAsync();
        }

        await using var context = database.CreateContext();
        context.HolidayCalendarDays.Add(CreateDay(date, 1405, 1, 2));

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task SolarDate_MustBeUnique()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();

        await using (var setupContext = database.CreateContext())
        {
            setupContext.HolidayCalendarDays.Add(CreateDay(new DateOnly(2026, 3, 21), 1405, 1, 1));
            await setupContext.SaveChangesAsync();
        }

        await using var context = database.CreateContext();
        context.HolidayCalendarDays.Add(CreateDay(new DateOnly(2026, 3, 22), 1405, 1, 1));

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task OccasionSourceAndNormalizedTitle_MustBeUniquePerDay()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var day = CreateDay(new DateOnly(2026, 3, 21), 1405, 1, 1);
        day.Occasions.Add(CreateOccasion("New Year", "new year", HolidayCalendarOccasionSource.Provider));
        day.Occasions.Add(CreateOccasion("New Year", "new year", HolidayCalendarOccasionSource.Provider));
        context.HolidayCalendarDays.Add(day);

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task Day_CanHaveOnlyOneOverride()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        int dayId;

        await using (var setupContext = database.CreateContext())
        {
            var day = CreateDay(new DateOnly(2026, 3, 21), 1405, 1, 1);
            setupContext.HolidayCalendarDays.Add(day);
            await setupContext.SaveChangesAsync();
            dayId = day.Id;

            setupContext.HolidayCalendarDayOverrides.Add(new HolidayCalendarDayOverride
            {
                HolidayCalendarDayId = dayId,
                Note = "Manual review"
            });
            await setupContext.SaveChangesAsync();
        }

        await using var context = database.CreateContext();
        context.HolidayCalendarDayOverrides.Add(new HolidayCalendarDayOverride
        {
            HolidayCalendarDayId = dayId,
            IsOfficialHoliday = false
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task DateOnlyAndOwnedRelationships_RoundTripAndCascade()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var expectedDate = new DateOnly(2026, 3, 21);
        int dayId;

        await using (var setupContext = database.CreateContext())
        {
            var day = CreateDay(expectedDate, 1405, 1, 1);
            day.Occasions.Add(CreateOccasion(
                "Provider occasion",
                "provider occasion",
                HolidayCalendarOccasionSource.Provider));
            day.Occasions.Add(CreateOccasion(
                "Manual occasion",
                "manual occasion",
                HolidayCalendarOccasionSource.Manual));
            day.Override = new HolidayCalendarDayOverride
            {
                IsOfficialHoliday = true,
                Note = "Verified manually"
            };
            setupContext.HolidayCalendarDays.Add(day);
            await setupContext.SaveChangesAsync();
            dayId = day.Id;
        }

        await using (var verificationContext = database.CreateContext())
        {
            var persisted = await verificationContext.HolidayCalendarDays
                .Include(day => day.Occasions)
                .Include(day => day.Override)
                .SingleAsync(day => day.Id == dayId);

            Assert.Equal(expectedDate, persisted.GregorianDate);
            Assert.Equal(2, persisted.Occasions.Count);
            Assert.Contains(
                persisted.Occasions,
                occasion => occasion.Source == HolidayCalendarOccasionSource.Provider);
            Assert.Contains(
                persisted.Occasions,
                occasion => occasion.Source == HolidayCalendarOccasionSource.Manual);
            Assert.NotNull(persisted.Override);

            verificationContext.HolidayCalendarDays.Remove(persisted);
            await verificationContext.SaveChangesAsync();
        }

        await using var cascadeContext = database.CreateContext();
        Assert.Empty(await cascadeContext.HolidayCalendarOccasions.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await cascadeContext.HolidayCalendarDayOverrides.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task HolidayClassification_IsEnforcedByTheDatabase()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var context = database.CreateContext();
        var invalidDay = CreateDay(new DateOnly(2026, 3, 21), 1405, 1, 1);
        invalidDay.IsOfficialHoliday = false;
        context.HolidayCalendarDays.Add(invalidDay);

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public void SyncState_RowVersionAndProviderIndex_AreConfigured()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(HolidayCalendarSyncState));
        Assert.NotNull(entityType);

        var rowVersion = entityType.FindProperty(nameof(HolidayCalendarSyncState.RowVersion));
        Assert.NotNull(rowVersion);
        Assert.True(rowVersion.IsConcurrencyToken);
        Assert.Equal(ValueGenerated.OnAddOrUpdate, rowVersion.ValueGenerated);

        var providerIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Count == 1 &&
                     index.Properties[0].Name == nameof(HolidayCalendarSyncState.ProviderName));
        Assert.True(providerIndex.IsUnique);
    }

    private static HolidayCalendarDay CreateDay(
        DateOnly gregorianDate,
        int solarYear,
        int solarMonth,
        int solarDay)
    {
        var isFriday = gregorianDate.DayOfWeek == DayOfWeek.Friday;
        return new HolidayCalendarDay
        {
            GregorianDate = gregorianDate,
            SolarYear = solarYear,
            SolarMonth = solarMonth,
            SolarDay = solarDay,
            DayOfWeek = gregorianDate.DayOfWeek,
            IsWeeklyHoliday = isFriday,
            IsOfficialHoliday = !isFriday,
            ProviderName = "PNLdev",
            SourceSolarYear = solarYear,
            LastProviderSyncAtUtc = new DateTime(2026, 7, 27, 0, 0, 0, DateTimeKind.Utc)
        };
    }

    private static HolidayCalendarOccasion CreateOccasion(
        string title,
        string normalizedTitle,
        HolidayCalendarOccasionSource source)
    {
        return new HolidayCalendarOccasion
        {
            Title = title,
            NormalizedTitle = normalizedTitle,
            Source = source
        };
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
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

        public KoochDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            return new KoochDbContext(options);
        }

        public async ValueTask DisposeAsync()
        {
            await connection.DisposeAsync();
        }
    }
}
