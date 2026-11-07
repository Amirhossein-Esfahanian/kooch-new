using Kooch.Api.Services.Weather;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherWorkerTests
{
    [Fact]
    public async Task Startup_IsNonBlocking_AndCanStopBeforeFirstRefresh()
    {
        var settings = new WeatherOptions { StartupDelaySeconds = 300 };
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
    }
}
