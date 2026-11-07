using Kooch.Api.Services.Weather;
using Kooch.Api.Data;
using Kooch.Api.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherWorkerTests
{
    [Fact]
    public async Task Startup_IsNonBlocking_AndCanStopBeforeFirstRefresh()
    {
        var settings = new WeatherOptions { Enabled = true, StartupDelaySeconds = 300 };
        using var services = new ServiceCollection().BuildServiceProvider();
        using var worker = new WeatherRefreshHostedService(services.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(settings), TimeProvider.System, NullLogger<WeatherRefreshHostedService>.Instance);
        await worker.StartAsync(default).WaitAsync(TimeSpan.FromSeconds(2));
        Assert.False(worker.ExecuteTask!.IsCompleted);
        await worker.StopAsync(default).WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
    }

    [Theory]
    [InlineData(false, 180)]
    [InlineData(true, 0)]
    public async Task DisabledOrInvalidConfiguration_DoesNotStartARefresh(bool enabled, int minutes)
    {
        using var services = new ServiceCollection().BuildServiceProvider();
        using var worker = new WeatherRefreshHostedService(services.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(new WeatherOptions { Enabled = enabled, RefreshMinutes = minutes }),
            TimeProvider.System, NullLogger<WeatherRefreshHostedService>.Instance);
        await worker.StartAsync(default);
        await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
    }

    [Fact]
    public void DependencyRegistration_ResolvesActualWeatherServicesWithoutStartingWorker()
    {
        var registrations = new ServiceCollection();
        registrations.AddLogging();
        registrations.AddSingleton(TimeProvider.System);
        registrations.AddSharedWeather(new ConfigurationBuilder().Build());
        using var services = registrations.BuildServiceProvider();
        Assert.IsType<VisualCrossingWeatherProvider>(services.GetRequiredService<IWeatherProvider>());
        Assert.IsType<EnvironmentWeatherApiKeySource>(services.GetRequiredService<IWeatherApiKeySource>());
        Assert.True(services.GetRequiredService<IOptions<WeatherOptions>>().Value.IsValid());
        Assert.False(services.GetRequiredService<IOptions<WeatherOptions>>().Value.Enabled);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void WeatherRegistration_IsIndependentOfAutomaticDatabaseMutations(bool automaticMutations, bool weatherEnabled)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AutomaticDatabaseMutations:Enabled"] = automaticMutations.ToString(),
            ["Weather:Enabled"] = weatherEnabled.ToString(),
        }).Build();
        var registrations = new ServiceCollection();
        registrations.AddSharedWeather(configuration);
        registrations.AddWriterHostedServices(AutomaticDatabaseMutationsStartup.IsEnabled(configuration));
        var workers = registrations.Where(registration => registration.ServiceType == typeof(IHostedService)).ToArray();
        Assert.Single(workers, registration => registration.ImplementationType == typeof(WeatherRefreshHostedService));
        Assert.Equal(automaticMutations ? 4 : 0, workers.Count(registration => registration.ImplementationType != typeof(WeatherRefreshHostedService)));
        using var services = registrations.BuildServiceProvider();
        Assert.Equal(weatherEnabled, services.GetRequiredService<IOptions<WeatherOptions>>().Value.Enabled);
    }

    [Fact]
    public async Task MissingWeatherConfiguration_StartsDisabledWithoutResolvingRefreshDependencies()
    {
        var registrations = new ServiceCollection();
        registrations.AddLogging();
        registrations.AddSingleton(TimeProvider.System);
        registrations.AddSharedWeather(new ConfigurationBuilder().Build());
        // Deliberately omit KoochDbContext: a disabled worker must never resolve WeatherService.
        using var services = registrations.BuildServiceProvider();
        using var worker = Assert.IsType<WeatherRefreshHostedService>(Assert.Single(services.GetServices<IHostedService>()));
        await worker.StartAsync(default);
        await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task EnabledWeather_RefreshesWhileAutomaticDatabaseMutationsAreDisabled()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AutomaticDatabaseMutations:Enabled"] = "false",
            ["Weather:Enabled"] = "true",
            ["Weather:StartupDelaySeconds"] = "0",
        }).Build();
        var registrations = new ServiceCollection();
        registrations.AddLogging();
        registrations.AddSingleton<TimeProvider>(fixture.Clock);
        registrations.AddSharedWeather(configuration);
        registrations.AddWriterHostedServices(AutomaticDatabaseMutationsStartup.IsEnabled(configuration));
        var provider = new StartupProvider(fixture);
        registrations.AddSingleton<IWeatherProvider>(provider);
        registrations.AddScoped<KoochDbContext>(_ => fixture.Context());
        await using var services = registrations.BuildServiceProvider();
        using var worker = Assert.IsType<WeatherRefreshHostedService>(Assert.Single(services.GetServices<IHostedService>()));
        await worker.StartAsync(default);
        try
        {
            await provider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(1, provider.Calls);
        }
        finally { await worker.StopAsync(default); }
    }

    private sealed class StartupProvider(WeatherDatabase fixture) : IWeatherProvider
    {
        public bool IsConfigured => true;
        public int Calls;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            Entered.TrySetResult();
            return Task.FromResult(fixture.Snapshot());
        }
    }
}
