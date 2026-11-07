using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Weather;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherServiceTests
{
    [Fact]
    public async Task FirstInitialization_PersistsOneSnapshot_AndReadsNeverFetch()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var provider = new FakeProvider(fixture);
        await using var context = fixture.Context();
        var service = fixture.Service(context, provider);
        Assert.Equal("unavailable", (await service.GetAsync(default)).Status);
        Assert.Equal(0, provider.Calls);
        Assert.Equal("refreshed", await service.RefreshAsync(default));
        var response = await service.GetAsync(default);
        Assert.Equal("available", response.Status);
        Assert.Equal(7, response.Days.Length);
        Assert.Equal(fixture.Clock.GetUtcNow().UtcDateTime, response.FetchedAtUtc);
        Assert.Equal("not_due_or_leased", await service.RefreshAsync(default));
        Assert.Equal(1, provider.Calls);
        var cache = await context.WeatherForecastCaches.AsNoTracking().SingleAsync();
        Assert.Null(cache.LeaseOwner);
        Assert.Null(cache.LeaseExpiresAtUtc);
        Assert.Equal(15, JsonSerializer.Deserialize<WeatherSnapshot>(cache.NormalizedForecastJson!)!.Days.Length);
    }

    [Fact]
    public async Task ConcurrentRefresh_OnlyLeaseWinnerCallsProvider()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var provider = new FakeProvider(fixture) { BeforeFetch = async () => { entered.SetResult(); await finish.Task; } };
        await using var first = fixture.Context();
        await using var second = fixture.Context();
        var winning = fixture.Service(first, provider).RefreshAsync(default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("not_due_or_leased", await fixture.Service(second, provider).RefreshAsync(default));
        finish.SetResult();
        Assert.Equal("refreshed", await winning);
        Assert.Equal(1, provider.Calls);
        Assert.Equal(1, await second.WeatherForecastCaches.CountAsync());
    }

    [Fact]
    public async Task ConcurrentFirstInsert_HasOneWinnerAndOneLocationRow()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<WeatherRefreshLease?> Acquire()
        {
            await start.Task;
            await using var context = fixture.Context();
            return await new WeatherForecastStore(context).TryAcquireAsync(fixture.Settings, fixture.Clock.GetUtcNow().UtcDateTime, default);
        }
        var first = Task.Run(Acquire);
        var second = Task.Run(Acquire);
        start.SetResult();
        var results = await Task.WhenAll(first, second);
        Assert.Single(results, lease => lease is not null);
        await using var verify = fixture.Context();
        Assert.Equal(1, await verify.WeatherForecastCaches.CountAsync());
    }

    [Fact]
    public async Task ExpiredLease_CanBeTakenOver_AndPreviousOwnerCannotSave()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using var first = fixture.Context();
        var oldStore = new WeatherForecastStore(first);
        var previous = await oldStore.TryAcquireAsync(fixture.Settings, fixture.Clock.GetUtcNow().UtcDateTime, default);
        fixture.Clock.Now = fixture.Clock.Now.AddSeconds(121);
        await using var second = fixture.Context();
        var nextStore = new WeatherForecastStore(second);
        var current = await nextStore.TryAcquireAsync(fixture.Settings, fixture.Clock.GetUtcNow().UtcDateTime, default);
        Assert.NotNull(current);
        Assert.False(await oldStore.SaveAsync(previous!, fixture.Snapshot(), fixture.Clock.GetUtcNow().UtcDateTime, default));
        Assert.True(await nextStore.SaveAsync(current!, fixture.Snapshot(), fixture.Clock.GetUtcNow().UtcDateTime, default));
    }

    [Fact]
    public async Task ProviderFailure_KeepsStaleSnapshotAndDefersOtherInstances()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using var context = fixture.Context();
        var provider = new FakeProvider(fixture);
        var service = fixture.Service(context, provider);
        await service.RefreshAsync(default);
        var before = await context.WeatherForecastCaches.AsNoTracking().SingleAsync();
        fixture.Clock.Now = fixture.Clock.Now.AddMinutes(181);
        provider.Fail = true;
        Assert.Equal("provider_unavailable", await service.RefreshAsync(default));
        Assert.Equal("stale", (await service.GetAsync(default)).Status);
        Assert.Equal("not_due_or_leased", await service.RefreshAsync(default));
        var after = await context.WeatherForecastCaches.AsNoTracking().SingleAsync();
        Assert.Equal(before.NormalizedForecastJson, after.NormalizedForecastJson);
        Assert.Equal(before.FetchedAtUtc, after.FetchedAtUtc);
        Assert.Equal(2, provider.Calls);
    }

    [Fact]
    public async Task InvalidSnapshot_DoesNotReplaceSuccessfulData()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using var context = fixture.Context();
        var provider = new FakeProvider(fixture);
        var service = fixture.Service(context, provider);
        await service.RefreshAsync(default);
        fixture.Clock.Now = fixture.Clock.Now.AddMinutes(181);
        provider.Invalid = true;
        Assert.Equal("provider_unavailable", await service.RefreshAsync(default));
        Assert.Equal("stale", (await service.GetAsync(default)).Status);
    }

    [Fact]
    public async Task MissingCredentials_SkipDatabaseAndProvider()
    {
        await using var fixture = await WeatherDatabase.CreateAsync(createTable: false);
        await using var context = fixture.Context();
        var provider = new FakeProvider(fixture) { IsConfigured = false };
        Assert.Equal("configuration_required", await fixture.Service(context, provider).RefreshAsync(default));
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task DisabledRefresh_SkipsDatabaseAndProvider()
    {
        await using var fixture = await WeatherDatabase.CreateAsync(createTable: false);
        fixture.Settings.Enabled = false;
        await using var context = fixture.Context();
        var provider = new FakeProvider(fixture);
        Assert.Equal("disabled", await fixture.Service(context, provider).RefreshAsync(default));
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task MissingStorage_ReturnsSafeUnavailableWithoutProviderCall()
    {
        await using var fixture = await WeatherDatabase.CreateAsync(createTable: false);
        await using var context = fixture.Context();
        var provider = new FakeProvider(fixture);
        var service = fixture.Service(context, provider);
        Assert.Equal("storage_unavailable", await service.RefreshAsync(default));
        Assert.Equal("unavailable", (await service.GetAsync(default)).Status);
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task ExpiredForecast_DoesNotReturnPastOrInventedDays()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using var context = fixture.Context();
        var service = fixture.Service(context, new FakeProvider(fixture));
        await service.RefreshAsync(default);
        fixture.Clock.Now = fixture.Clock.Now.AddDays(16);
        var response = await service.GetAsync(default);
        Assert.Equal("forecast_expired", response.UnavailableReason);
        Assert.Empty(response.Days);
        Assert.NotNull(response.FetchedAtUtc);
    }

    [Fact]
    public async Task CancelledRefresh_LeavesNoSuccessfulSnapshot()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using var context = fixture.Context();
        using var cancellation = new CancellationTokenSource();
        var provider = new FakeProvider(fixture) { BeforeFetch = () => { cancellation.Cancel(); return Task.CompletedTask; } };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => fixture.Service(context, provider).RefreshAsync(cancellation.Token));
        Assert.Null((await context.WeatherForecastCaches.AsNoTracking().SingleAsync()).FetchedAtUtc);
    }

    [Fact]
    public async Task DisplayDays_UsesTehranDateAcrossUtcMidnightBoundary()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        fixture.Clock.Now = new DateTimeOffset(2026, 11, 7, 21, 0, 0, TimeSpan.Zero);
        await using var context = fixture.Context();
        var service = fixture.Service(context, new FakeProvider(fixture));
        Assert.Equal("refreshed", await service.RefreshAsync(default));
        Assert.Equal(new DateOnly(2026, 11, 8), (await service.GetAsync(default)).Days[0].Date);
    }

    [Theory]
    [InlineData(7, "unavailable", 0)]
    [InlineData(8, "stale", 7)]
    [InlineData(15, "stale", 7)]
    public async Task StoredSnapshot_AfterTehranMidnight_DropsYesterdayAndRequiresAFullDisplayWindow(int count, string status, int displayed)
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        fixture.Clock.Now = DateTimeOffset.Parse("2026-11-07T20:29:59Z");
        await using var context = fixture.Context();
        var store = new WeatherForecastStore(context);
        var lease = await store.TryAcquireAsync(fixture.Settings, fixture.Clock.Now.UtcDateTime, default);
        Assert.True(await store.SaveAsync(lease!, fixture.Snapshot() with { Days = fixture.Snapshot().Days.Take(count).ToArray() },
            fixture.Clock.Now.UtcDateTime, default));
        var service = fixture.Service(context, new FakeProvider(fixture));
        Assert.Equal("available", (await service.GetAsync(default)).Status);
        fixture.Clock.Now = fixture.Clock.Now.AddSeconds(1);
        var response = await service.GetAsync(default);
        Assert.Equal(status, response.Status);
        Assert.Equal(displayed, response.Days.Length);
        Assert.DoesNotContain(response.Days, day => day.Date == new DateOnly(2026, 11, 7));
        if (displayed > 0) Assert.Equal(new DateOnly(2026, 11, 8), response.Days[0].Date);
        else Assert.Equal("forecast_expired", response.UnavailableReason);
    }

    private sealed class FakeProvider(WeatherDatabase fixture) : IWeatherProvider
    {
        public bool IsConfigured { get; set; } = true;
        public int Calls;
        public bool Fail;
        public bool Invalid;
        public Func<Task>? BeforeFetch;
        public async Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            if (BeforeFetch is not null) await BeforeFetch();
            cancellationToken.ThrowIfCancellationRequested();
            if (Fail) throw new WeatherProviderException();
            return Invalid ? fixture.Snapshot() with { Days = [] } : fixture.Snapshot();
        }
    }
}

internal sealed class WeatherTestClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = new(2026, 11, 7, 8, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
}

internal sealed class WeatherDatabase : IAsyncDisposable
{
    private readonly string path = Path.Combine(Path.GetTempPath(), $"kooch-weather-{Guid.NewGuid():N}.db");
    public WeatherOptions Settings { get; } = new() { Enabled = true };
    public WeatherTestClock Clock { get; } = new();
    public KoochDbContext Context() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlite($"Data Source={path};Pooling=False;Default Timeout=10").Options);
    public WeatherService Service(KoochDbContext context, IWeatherProvider provider) => new(
        new WeatherForecastStore(context), provider, Options.Create(Settings), Clock, NullLogger<WeatherService>.Instance);
    public WeatherSnapshot Snapshot() => new(Settings.LocationKey, Settings.UnitGroup, Settings.Language,
        Enumerable.Range(0, Settings.ForecastDays).Select(index => new WeatherDay(
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Clock.Now, Kooch.Api.Services.IranSiteTime.BusinessTimeZone).DateTime)
                .AddDays(index), 10, 20, 5, "آفتابی", "clear-day")).ToArray());

    public static async Task<WeatherDatabase> CreateAsync(bool createTable = true)
    {
        var fixture = new WeatherDatabase();
        if (createTable)
        {
            await using var context = fixture.Context();
            // Isolated SQLite schema mirrors the existing SQL Server cache; the trigger emulates rowversion.
            await context.Database.ExecuteSqlRawAsync("""
                CREATE TABLE WeatherForecastCaches (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    LocationKey TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    NormalizedForecastJson TEXT NULL, FetchedAtUtc TEXT NULL,
                    LeaseOwner TEXT NULL, LeaseExpiresAtUtc TEXT NULL,
                    RowVersion BLOB NOT NULL DEFAULT (randomblob(8)),
                    CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NULL,
                    CreatedByUserId INTEGER NULL, UpdatedByUserId INTEGER NULL,
                    DeletedAtUtc TEXT NULL, DeletedByUserId INTEGER NULL, IsDeleted INTEGER NOT NULL);
                CREATE TRIGGER WeatherRowVersion AFTER UPDATE ON WeatherForecastCaches BEGIN
                    UPDATE WeatherForecastCaches SET RowVersion = randomblob(8) WHERE Id = NEW.Id;
                END;
                """);
        }
        return fixture;
    }

    public ValueTask DisposeAsync()
    {
        File.Delete(path);
        return ValueTask.CompletedTask;
    }
}
