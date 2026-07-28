using Kooch.Api.Services.Holidays;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class HolidayCalendarSyncHostedServiceTests
{
    private static readonly DateTimeOffset DefaultNow = new(2026, 7, 28, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task DisabledService_PerformsNoSynchronization()
    {
        await using var harness = CreateHarness(new HolidayCalendarSynchronizationOptions { Enabled = false });

        await harness.StartAsync();
        harness.TimeProvider.Advance(TimeSpan.FromDays(400));
        await Task.Yield();

        Assert.Equal(0, harness.Recorder.CallCount);
    }

    [Fact]
    public async Task RunOnStartup_InvokesOnceAfterConfiguredDelay()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 10;
        await using var harness = CreateHarness(options);

        await harness.StartAsync();
        await WaitUntilAsync(() => harness.TimeProvider.ActiveTimerCount > 0);
        harness.TimeProvider.Advance(TimeSpan.FromSeconds(9));
        await Task.Yield();
        Assert.Equal(0, harness.Recorder.CallCount);

        harness.TimeProvider.Advance(TimeSpan.FromSeconds(1));
        await WaitUntilAsync(() => harness.Recorder.CallCount == 1);

        Assert.Equal(2, Assert.Single(harness.Recorder.YearsAhead));
    }

    [Fact]
    public async Task StartAsync_DoesNotWaitForStartupDelay()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 3600;
        await using var harness = CreateHarness(options);

        await harness.HostedService.StartAsync(CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(0, harness.Recorder.CallCount);
    }

    [Theory]
    [InlineData("Iran Standard Time")]
    [InlineData("Asia/Tehran")]
    public void IranTimezoneResolution_SupportsWindowsAndLinuxIdentifiers(string timeZoneId)
    {
        var resolved = HolidayCalendarSyncSchedule.TryResolveIranTimeZone(timeZoneId, out var timeZone);

        Assert.True(resolved);
        Assert.NotNull(timeZone);
    }

    [Fact]
    public void SolarYearResolver_UsesIranLocalTimeAroundNowruz()
    {
        Assert.True(HolidayCalendarSyncSchedule.TryResolveIranTimeZone(
            HolidayCalendarSyncSchedule.WindowsIranTimeZoneId,
            out var iranTimeZone));
        var beforeProvider = new ManualTimeProvider(new DateTimeOffset(2026, 3, 20, 20, 29, 0, TimeSpan.Zero));
        var afterProvider = new ManualTimeProvider(new DateTimeOffset(2026, 3, 20, 20, 31, 0, TimeSpan.Zero));
        var beforeResolver = CreateSolarYearResolver(beforeProvider);
        var afterResolver = CreateSolarYearResolver(afterProvider);

        Assert.True(beforeResolver.TryGetCurrentSolarYear(iranTimeZone!, out var beforeYear));
        Assert.True(afterResolver.TryGetCurrentSolarYear(iranTimeZone!, out var afterYear));
        Assert.Equal(1404, beforeYear);
        Assert.Equal(1405, afterYear);
    }

    [Fact]
    public async Task InvalidTimezone_SkipsSynchronizationWithoutStoppingHost()
    {
        var options = EnabledOptions();
        options.IranTimeZoneId = "Invalid/Kooch-TimeZone";
        await using var harness = CreateHarness(options);

        await harness.StartAsync();
        await Task.Delay(50);

        Assert.Equal(0, harness.Recorder.CallCount);
        Assert.False(harness.HostedService.ExecuteTask?.IsCompleted ?? true);
    }

    [Fact]
    public void NextRun_UsesConfiguredIranLocalTime()
    {
        var timeZone = ResolveIranTimeZone();
        var utcNow = ToUtc(new DateTime(2026, 7, 10, 12, 0, 0), timeZone);

        var nextUtc = HolidayCalendarSyncSchedule.GetNextRunUtc(utcNow, timeZone, 15, 3, 30);
        var nextLocal = TimeZoneInfo.ConvertTime(nextUtc, timeZone);

        Assert.Equal(new DateTime(2026, 7, 15, 3, 30, 0), nextLocal.DateTime);
    }

    [Fact]
    public void NextRun_ClampsDayToFinalDayOfMonth()
    {
        var timeZone = ResolveIranTimeZone();
        var utcNow = ToUtc(new DateTime(2027, 2, 10, 12, 0, 0), timeZone);

        var nextUtc = HolidayCalendarSyncSchedule.GetNextRunUtc(utcNow, timeZone, 31, 3, 0);
        var nextLocal = TimeZoneInfo.ConvertTime(nextUtc, timeZone);

        Assert.Equal(new DateTime(2027, 2, 28, 3, 0, 0), nextLocal.DateTime);
    }

    [Fact]
    public void NextRun_AdvancesAfterCurrentMonthsSlot()
    {
        var timeZone = ResolveIranTimeZone();
        var utcNow = ToUtc(new DateTime(2026, 7, 15, 3, 1, 0), timeZone);

        var nextUtc = HolidayCalendarSyncSchedule.GetNextRunUtc(utcNow, timeZone, 15, 3, 0);
        var nextLocal = TimeZoneInfo.ConvertTime(nextUtc, timeZone);

        Assert.Equal(new DateTime(2026, 8, 15, 3, 0, 0), nextLocal.DateTime);
    }

    [Fact]
    public async Task FailureResult_DoesNotTerminateHostedService()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 0;
        var invocation = 0;
        await using var harness = CreateHarness(options, handler: (year, _) =>
        {
            invocation++;
            return Task.FromResult(invocation == 1
                ? FailureResult(year)
                : SuccessResult(year));
        });

        await harness.StartAsync();
        await WaitUntilAsync(() => harness.Recorder.CallCount == 1);
        await AdvanceToNextScheduledRunAsync(harness, options);

        Assert.Equal(2, harness.Recorder.CallCount);
        Assert.False(harness.HostedService.ExecuteTask?.IsCompleted ?? true);
    }

    [Fact]
    public async Task UnexpectedException_DoesNotTerminateHostedService()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 0;
        var invocation = 0;
        await using var harness = CreateHarness(options, handler: (year, _) =>
        {
            invocation++;
            return invocation == 1
                ? Task.FromException<HolidayCalendarSynchronizationResult>(new InvalidOperationException("Simulated"))
                : Task.FromResult(SuccessResult(year));
        });

        await harness.StartAsync();
        await WaitUntilAsync(() => harness.Recorder.CallCount == 1);
        await AdvanceToNextScheduledRunAsync(harness, options);

        Assert.Equal(2, harness.Recorder.CallCount);
        Assert.False(harness.HostedService.ExecuteTask?.IsCompleted ?? true);
    }

    [Fact]
    public async Task Cancellation_StopsScheduledWaitPromptly()
    {
        var options = EnabledOptions();
        options.RunOnStartup = false;
        await using var harness = CreateHarness(options);
        await harness.StartAsync();
        await WaitUntilAsync(() => harness.TimeProvider.ActiveTimerCount > 0);

        await harness.HostedService.StopAsync(CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(0, harness.Recorder.CallCount);
    }

    [Fact]
    public async Task EachRun_UsesASeparateDependencyInjectionScope()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 0;
        await using var harness = CreateHarness(options);

        await harness.StartAsync();
        await WaitUntilAsync(() => harness.Recorder.CallCount == 1);
        await AdvanceToNextScheduledRunAsync(harness, options);

        Assert.Equal(2, harness.Recorder.ServiceInstanceIds.Distinct().Count());
    }

    [Fact]
    public async Task Runs_DoNotOverlap()
    {
        var options = EnabledOptions();
        options.StartupDelaySeconds = 0;
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var harness = CreateHarness(options, handler: async (year, cancellationToken) =>
        {
            await release.Task.WaitAsync(cancellationToken);
            return SuccessResult(year);
        });

        await harness.StartAsync();
        await WaitUntilAsync(() => harness.Recorder.CallCount == 1);
        harness.TimeProvider.Advance(TimeSpan.FromDays(400));
        await Task.Yield();

        Assert.Equal(1, harness.Recorder.CallCount);
        Assert.Equal(1, harness.Recorder.MaximumConcurrentCalls);
        release.SetResult();
    }

    private static HolidayCalendarSynchronizationOptions EnabledOptions() => new()
    {
        Enabled = true,
        RunOnStartup = true,
        StartupDelaySeconds = 10,
        InitialYearsAhead = 2,
        SyncDayOfMonth = 1,
        SyncHourLocal = 3,
        SyncMinuteLocal = 0,
        IranTimeZoneId = HolidayCalendarSyncSchedule.WindowsIranTimeZoneId
    };

    private static HostedServiceHarness CreateHarness(
        HolidayCalendarSynchronizationOptions options,
        DateTimeOffset? now = null,
        Func<int, CancellationToken, Task<HolidayCalendarSynchronizationResult>>? handler = null)
    {
        var timeProvider = new ManualTimeProvider(now ?? DefaultNow);
        var recorder = new SynchronizationRecorder(handler);
        var services = new ServiceCollection();
        services.AddScoped<IHolidayCalendarSynchronizationService>(_ =>
            new RecordingSynchronizationService(recorder, Guid.NewGuid()));
        var serviceProvider = services.BuildServiceProvider();
        var hostedService = new HolidayCalendarSyncHostedService(
            serviceProvider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            timeProvider,
            CreateSolarYearResolver(timeProvider),
            NullLogger<HolidayCalendarSyncHostedService>.Instance);
        return new HostedServiceHarness(serviceProvider, hostedService, timeProvider, recorder);
    }

    private static HolidayCalendarSolarYearResolver CreateSolarYearResolver(TimeProvider timeProvider) =>
        new(timeProvider, NullLogger<HolidayCalendarSolarYearResolver>.Instance);

    private static HolidayCalendarSynchronizationResult SuccessResult(int year) =>
        new(true, year, year + 2, []);

    private static HolidayCalendarSynchronizationResult FailureResult(int year) =>
        new(
            false,
            year,
            year + 2,
            [],
            failureCategory: HolidayCalendarSynchronizationFailureCategory.Provider,
            errorSummary: "Provider unavailable.");

    private static TimeZoneInfo ResolveIranTimeZone()
    {
        Assert.True(HolidayCalendarSyncSchedule.TryResolveIranTimeZone(
            HolidayCalendarSyncSchedule.WindowsIranTimeZoneId,
            out var timeZone));
        return timeZone!;
    }

    private static DateTimeOffset ToUtc(DateTime localTime, TimeZoneInfo timeZone)
    {
        var unspecified = DateTime.SpecifyKind(localTime, DateTimeKind.Unspecified);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(unspecified, timeZone), TimeSpan.Zero);
    }

    private static async Task AdvanceToNextScheduledRunAsync(
        HostedServiceHarness harness,
        HolidayCalendarSynchronizationOptions options)
    {
        await WaitUntilAsync(() => harness.TimeProvider.ActiveTimerCount > 0);
        var nextRunUtc = HolidayCalendarSyncSchedule.GetNextRunUtc(
            harness.TimeProvider.GetUtcNow(),
            ResolveIranTimeZone(),
            options.SyncDayOfMonth,
            options.SyncHourLocal,
            options.SyncMinuteLocal);
        harness.TimeProvider.Advance(nextRunUtc - harness.TimeProvider.GetUtcNow());
        await WaitUntilAsync(() => harness.Recorder.CallCount >= 2);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var timeoutAt = DateTime.UtcNow.AddSeconds(3);
        while (!condition())
        {
            if (DateTime.UtcNow >= timeoutAt)
            {
                throw new TimeoutException("The expected hosted-service condition was not reached.");
            }

            await Task.Delay(10);
        }
    }

    private sealed class HostedServiceHarness(
        ServiceProvider serviceProvider,
        HolidayCalendarSyncHostedService hostedService,
        ManualTimeProvider timeProvider,
        SynchronizationRecorder recorder) : IAsyncDisposable
    {
        public HolidayCalendarSyncHostedService HostedService { get; } = hostedService;
        public ManualTimeProvider TimeProvider { get; } = timeProvider;
        public SynchronizationRecorder Recorder { get; } = recorder;

        public Task StartAsync() => HostedService.StartAsync(CancellationToken.None);

        public async ValueTask DisposeAsync()
        {
            await HostedService.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1));
            HostedService.Dispose();
            await serviceProvider.DisposeAsync();
        }
    }

    private sealed class SynchronizationRecorder(
        Func<int, CancellationToken, Task<HolidayCalendarSynchronizationResult>>? handler)
    {
        private int callCount;
        private int concurrentCalls;
        private int maximumConcurrentCalls;

        public int CallCount => Volatile.Read(ref callCount);
        public int MaximumConcurrentCalls => Volatile.Read(ref maximumConcurrentCalls);
        public List<Guid> ServiceInstanceIds { get; } = [];
        public List<int> YearsAhead { get; } = [];

        public async Task<HolidayCalendarSynchronizationResult> InvokeAsync(
            Guid serviceInstanceId,
            int year,
            int yearsAhead,
            CancellationToken cancellationToken)
        {
            lock (ServiceInstanceIds)
            {
                ServiceInstanceIds.Add(serviceInstanceId);
                YearsAhead.Add(yearsAhead);
            }

            Interlocked.Increment(ref callCount);
            var concurrent = Interlocked.Increment(ref concurrentCalls);
            UpdateMaximumConcurrentCalls(concurrent);
            try
            {
                return handler is null
                    ? SuccessResult(year)
                    : await handler(year, cancellationToken);
            }
            finally
            {
                Interlocked.Decrement(ref concurrentCalls);
            }
        }

        private void UpdateMaximumConcurrentCalls(int candidate)
        {
            while (true)
            {
                var current = Volatile.Read(ref maximumConcurrentCalls);
                if (candidate <= current ||
                    Interlocked.CompareExchange(ref maximumConcurrentCalls, candidate, current) == current)
                {
                    return;
                }
            }
        }
    }

    private sealed class RecordingSynchronizationService(
        SynchronizationRecorder recorder,
        Guid serviceInstanceId) : IHolidayCalendarSynchronizationService
    {
        public Task<HolidayCalendarSynchronizationResult> SyncYearAsync(
            int solarYear,
            CancellationToken cancellationToken = default) =>
            recorder.InvokeAsync(serviceInstanceId, solarYear, 0, cancellationToken);

        public Task<HolidayCalendarSynchronizationResult> SyncWindowAsync(
            int currentSolarYear,
            int yearsAhead,
            CancellationToken cancellationToken = default) =>
            recorder.InvokeAsync(serviceInstanceId, currentSolarYear, yearsAhead, cancellationToken);
    }

    private sealed class ManualTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        private readonly object gate = new();
        private readonly List<ManualTimer> timers = [];
        private DateTimeOffset currentUtc = utcNow;

        public int ActiveTimerCount
        {
            get
            {
                lock (gate)
                {
                    return timers.Count(timer => timer.IsActive);
                }
            }
        }

        public override DateTimeOffset GetUtcNow()
        {
            lock (gate)
            {
                return currentUtc;
            }
        }

        public override ITimer CreateTimer(
            TimerCallback callback,
            object? state,
            TimeSpan dueTime,
            TimeSpan period)
        {
            var timer = new ManualTimer(this, callback, state);
            lock (gate)
            {
                timers.Add(timer);
            }

            timer.Change(dueTime, period);
            return timer;
        }

        public void Advance(TimeSpan duration)
        {
            if (duration < TimeSpan.Zero)
            {
                throw new ArgumentOutOfRangeException(nameof(duration));
            }

            ManualTimer[] dueTimers;
            lock (gate)
            {
                currentUtc = currentUtc.Add(duration);
                dueTimers = timers.Where(timer => timer.IsDue(currentUtc)).ToArray();
            }

            foreach (var timer in dueTimers)
            {
                timer.Fire();
            }
        }

        private sealed class ManualTimer(
            ManualTimeProvider owner,
            TimerCallback callback,
            object? state) : ITimer
        {
            private DateTimeOffset? dueAtUtc;
            private TimeSpan period = Timeout.InfiniteTimeSpan;
            private bool disposed;

            public bool IsActive => !disposed && dueAtUtc.HasValue;

            public bool Change(TimeSpan dueTime, TimeSpan newPeriod)
            {
                lock (owner.gate)
                {
                    if (disposed)
                    {
                        return false;
                    }

                    dueAtUtc = dueTime == Timeout.InfiniteTimeSpan
                        ? null
                        : owner.currentUtc.Add(dueTime);
                    period = newPeriod;
                    return true;
                }
            }

            public bool IsDue(DateTimeOffset now)
            {
                lock (owner.gate)
                {
                    return IsActive && dueAtUtc <= now;
                }
            }

            public void Fire()
            {
                lock (owner.gate)
                {
                    if (!IsActive)
                    {
                        return;
                    }

                    dueAtUtc = period == Timeout.InfiniteTimeSpan
                        ? null
                        : owner.currentUtc.Add(period);
                }

                callback(state);
            }

            public void Dispose()
            {
                lock (owner.gate)
                {
                    disposed = true;
                    dueAtUtc = null;
                }
            }

            public ValueTask DisposeAsync()
            {
                Dispose();
                return ValueTask.CompletedTask;
            }
        }
    }
}
