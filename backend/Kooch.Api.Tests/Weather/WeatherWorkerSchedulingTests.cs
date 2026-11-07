using System.Threading.Channels;
using Kooch.Api.Data;
using Kooch.Api.Services.Weather;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherWorkerSchedulingTests
{
    [Fact]
    public async Task ExistingCooldown_IsRespected_ThenRetriedAtNextPoll_WithoutFrequentSuccessfulFetches()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        await using (var context = fixture.Context())
        {
            var store = new WeatherForecastStore(context);
            var lease = await store.TryAcquireAsync(fixture.Settings, fixture.Clock.Now.UtcDateTime, default);
            Assert.Equal(1, await store.DeferAsync(lease!, fixture.Clock.Now.UtcDateTime, 180, default));
        }
        var clock = new PollClock(fixture.Clock);
        var provider = new ControlledProvider(fixture);
        await using var services = Services(fixture, clock, provider);
        using var worker = Worker(services, fixture, clock);
        await worker.StartAsync(default);
        try
        {
            Assert.Equal(TimeSpan.FromMinutes(1), await clock.NextDelay());
            Assert.Equal(0, provider.Calls);
            clock.Advance(TimeSpan.FromMinutes(179));
            await clock.NextDelay();
            Assert.Equal(0, provider.Calls);
            clock.Advance(TimeSpan.FromMinutes(1));
            await clock.NextDelay();
            Assert.Equal(1, provider.Calls);
            await using var verify = fixture.Context();
            Assert.Equal("available", (await fixture.Service(verify, provider).GetAsync(default)).Status);
            clock.Advance(TimeSpan.FromMinutes(1));
            await clock.NextDelay();
            Assert.Equal(1, provider.Calls);
            clock.Advance(TimeSpan.FromMinutes(179));
            await clock.NextDelay();
            Assert.Equal(2, provider.Calls);
        }
        finally { await worker.StopAsync(default); }
    }

    [Fact]
    public async Task ProviderFailure_UsesSeparateBoundedCooldown_AndRecoversAutomatically()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var clock = new PollClock(fixture.Clock);
        var provider = new ControlledProvider(fixture) { Fail = true };
        await using var services = Services(fixture, clock, provider);
        using var worker = Worker(services, fixture, clock);
        await worker.StartAsync(default);
        try
        {
            await clock.NextDelay();
            Assert.Equal(1, provider.Calls);
            clock.Advance(TimeSpan.FromMinutes(14));
            await clock.NextDelay();
            Assert.Equal(1, provider.Calls);
            provider.Fail = false;
            clock.Advance(TimeSpan.FromMinutes(1));
            await clock.NextDelay();
            Assert.Equal(2, provider.Calls);
            await using var context = fixture.Context();
            Assert.Equal("available", (await fixture.Service(context, provider).GetAsync(default)).Status);
        }
        finally { await worker.StopAsync(default); }
    }

    [Fact]
    public async Task InFlightRefresh_IsAwaited_WithoutSchedulingAnOverlappingCall()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var clock = new PollClock(fixture.Clock);
        var provider = new ControlledProvider(fixture) { Hold = true };
        await using var services = Services(fixture, clock, provider);
        using var worker = Worker(services, fixture, clock);
        await worker.StartAsync(default);
        try
        {
            await provider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(clock.HasScheduledDelay);
            clock.Advance(TimeSpan.FromMinutes(1));
            Assert.Equal(1, provider.Calls);
            provider.Release.SetResult();
            await clock.NextDelay();
            Assert.Equal(1, provider.Calls);
        }
        finally { await worker.StopAsync(default); }
    }

    [Theory]
    [InlineData(0, 15)]
    [InlineData(1, 0)]
    [InlineData(1, 181)]
    [InlineData(20, 15)]
    public void InvalidPollingAndRetryIntervals_AreRejected(int poll, int retry) =>
        Assert.False(new WeatherOptions { PollMinutes = poll, FailureRetryMinutes = retry }.IsValid());

    private static ServiceProvider Services(WeatherDatabase fixture, TimeProvider clock, IWeatherProvider provider)
    {
        fixture.Settings.StartupDelaySeconds = 0;
        var registrations = new ServiceCollection();
        registrations.AddLogging();
        registrations.AddSingleton(clock);
        registrations.AddSingleton(Options.Create(fixture.Settings));
        registrations.AddSingleton(provider);
        registrations.AddScoped<KoochDbContext>(_ => fixture.Context());
        registrations.AddScoped<WeatherForecastStore>();
        registrations.AddScoped<WeatherService>();
        return registrations.BuildServiceProvider();
    }

    private static WeatherRefreshHostedService Worker(ServiceProvider services, WeatherDatabase fixture, TimeProvider clock) =>
        new(services.GetRequiredService<IServiceScopeFactory>(), Options.Create(fixture.Settings), clock,
            NullLogger<WeatherRefreshHostedService>.Instance);

    private sealed class ControlledProvider(WeatherDatabase fixture) : IWeatherProvider
    {
        public bool IsConfigured => true;
        public int Calls;
        public bool Fail, Hold;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            Entered.TrySetResult();
            if (Hold) await Release.Task.WaitAsync(cancellationToken);
            if (Fail) throw new WeatherProviderException(WeatherProviderFailureKind.Http, 503);
            return fixture.Snapshot();
        }
    }

    private sealed class PollClock(WeatherTestClock clock) : TimeProvider
    {
        private readonly object gate = new();
        private readonly List<PollTimer> timers = [];
        private readonly Channel<TimeSpan> delays = Channel.CreateUnbounded<TimeSpan>();
        public bool HasScheduledDelay => delays.Reader.TryPeek(out _);
        public override DateTimeOffset GetUtcNow() => clock.Now;
        public async Task<TimeSpan> NextDelay() => await delays.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new PollTimer(this, callback, state);
            lock (gate) timers.Add(timer);
            timer.Change(dueTime, period);
            delays.Writer.TryWrite(dueTime);
            return timer;
        }
        public void Advance(TimeSpan duration)
        {
            PollTimer[] due;
            lock (gate)
            {
                clock.Now += duration;
                due = timers.Where(timer => timer.Due <= clock.Now).ToArray();
                foreach (var timer in due) timer.Due = DateTimeOffset.MaxValue;
            }
            foreach (var timer in due) timer.Fire();
        }
        private sealed class PollTimer(PollClock owner, TimerCallback callback, object? state) : ITimer
        {
            public DateTimeOffset Due = DateTimeOffset.MaxValue;
            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                Assert.Equal(Timeout.InfiniteTimeSpan, period);
                lock (owner.gate) Due = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : owner.GetUtcNow() + dueTime;
                return true;
            }
            public void Fire() => callback(state);
            public void Dispose() { lock (owner.gate) owner.timers.Remove(this); }
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }
}
