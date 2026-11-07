using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Services.Weather;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherPipelineIntegrationTests
{
    [Fact]
    public async Task AutomaticWorker_PersistsSnapshot_PublicReadsReuseIt_AndFailedRefreshPreservesIt()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        fixture.Settings.StartupDelaySeconds = 0;
        var provider = new PipelineProvider(fixture);
        var logger = new PipelineLogger();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(WeatherController).Assembly);
        builder.Services.AddSingleton<IWeatherProvider>(provider);
        builder.Services.AddSingleton<TimeProvider>(fixture.Clock);
        builder.Services.AddSingleton(Options.Create(fixture.Settings));
        builder.Services.AddSingleton<ILogger<WeatherService>>(logger);
        builder.Services.AddScoped<KoochDbContext>(_ => fixture.Context());
        builder.Services.AddScoped<WeatherForecastStore>();
        builder.Services.AddScoped<WeatherService>();
        builder.Services.AddHostedService<WeatherRefreshHostedService>();
        await using var app = builder.Build();
        app.MapControllers();
        await app.StartAsync();
        try
        {
            await logger.Persisted.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(1, provider.Calls);
            await using var verify = fixture.Context();
            var saved = await verify.WeatherForecastCaches.AsNoTracking().SingleAsync();
            Assert.Equal(fixture.Clock.Now.UtcDateTime, saved.FetchedAtUtc);
            Assert.Null(saved.LeaseOwner);
            Assert.Null(saved.LeaseExpiresAtUtc);
            var snapshot = JsonSerializer.Deserialize<WeatherSnapshot>(saved.NormalizedForecastJson!);
            Assert.True(WeatherSnapshotValidation.IsValid(snapshot, fixture.Settings));
            Assert.Equal(15, snapshot!.Days.Length);

            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address) };
            for (var i = 0; i < 2; i++)
            {
                var response = await client.GetFromJsonAsync<WeatherResponse>("/api/weather");
                Assert.Equal("available", response!.Status);
                Assert.Equal(saved.FetchedAtUtc, response.FetchedAtUtc);
                Assert.Equal(7, response.Days.Length);
                Assert.Equal(WeatherForecastWindow.Today(fixture.Clock), response.Days[0].Date);
            }
            Assert.Equal(1, provider.Calls);
            var readOnly = await verify.WeatherForecastCaches.AsNoTracking().SingleAsync();
            Assert.Equal(saved.RowVersion, readOnly.RowVersion);

            fixture.Clock.Now = fixture.Clock.Now.AddMinutes(181);
            provider.Fail = true;
            await using (var scope = app.Services.CreateAsyncScope())
                Assert.Equal("provider_unavailable", await scope.ServiceProvider.GetRequiredService<WeatherService>().RefreshAsync(default));
            var after = await verify.WeatherForecastCaches.AsNoTracking().SingleAsync();
            Assert.Equal(saved.NormalizedForecastJson, after.NormalizedForecastJson);
            Assert.Equal(saved.FetchedAtUtc, after.FetchedAtUtc);
            Assert.Equal(fixture.Clock.Now.UtcDateTime.AddMinutes(15), after.LeaseExpiresAtUtc);
            var stale = await client.GetFromJsonAsync<WeatherResponse>("/api/weather");
            Assert.Equal("stale", stale!.Status);
            Assert.Equal(7, stale.Days.Length);
            Assert.Equal(2, provider.Calls);
            Assert.Contains(logger.Messages, message => message.Contains("snapshot persisted"));
            Assert.Contains(logger.Messages, message => message.Contains("category Http") && message.Contains("503"));
            Assert.DoesNotContain(logger.Messages, message => message.Contains("https://") || message.Contains("apiKey"));
        }
        finally { await app.StopAsync(); }
    }

    private sealed class PipelineProvider(WeatherDatabase fixture) : IWeatherProvider
    {
        public bool IsConfigured => true;
        public int Calls;
        public bool Fail;
        public Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            if (Fail) throw new WeatherProviderException(WeatherProviderFailureKind.Http, 503);
            return Task.FromResult(fixture.Snapshot());
        }
    }

    private sealed class PipelineLogger : ILogger<WeatherService>
    {
        public ConcurrentQueue<string> Messages { get; } = new();
        public TaskCompletionSource Persisted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            Assert.Null(exception);
            var message = formatter(state, exception);
            Messages.Enqueue(message);
            if (message.Contains("snapshot persisted")) Persisted.TrySetResult();
        }
    }
}
