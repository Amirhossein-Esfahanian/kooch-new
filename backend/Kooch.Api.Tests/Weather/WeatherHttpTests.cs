using System.Net;
using System.Net.Http.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Services.Weather;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherHttpTests
{
    [Fact]
    public async Task AnonymousGet_IsCachedReadOnlyAndRemainsReadableWhenRefreshDisabled()
    {
        await using var fixture = await WeatherDatabase.CreateAsync();
        var provider = new CountingProvider(fixture);
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(WeatherController).Assembly);
        builder.Services.AddSingleton<IWeatherProvider>(provider);
        builder.Services.AddSingleton<TimeProvider>(fixture.Clock);
        builder.Services.AddSingleton(Options.Create(fixture.Settings));
        builder.Services.AddScoped<KoochDbContext>(_ => fixture.Context());
        builder.Services.AddScoped<WeatherForecastStore>();
        builder.Services.AddScoped<WeatherService>();
        await using var app = builder.Build();
        app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        using var empty = await client.GetAsync("/api/weather");
        Assert.Equal(HttpStatusCode.OK, empty.StatusCode);
        Assert.True(empty.Headers.CacheControl!.Public);
        Assert.Equal(TimeSpan.FromMinutes(30), empty.Headers.CacheControl.MaxAge);
        Assert.Equal("unavailable", (await empty.Content.ReadFromJsonAsync<WeatherResponse>())!.Status);
        Assert.Equal(0, provider.Calls);

        await using (var scope = app.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<WeatherService>().RefreshAsync(default);
        fixture.Settings.Enabled = false;
        await using (var scope = app.Services.CreateAsyncScope())
            Assert.Equal("disabled", await scope.ServiceProvider.GetRequiredService<WeatherService>().RefreshAsync(default));
        using var filled = await client.GetAsync("/api/weather");
        var response = await filled.Content.ReadFromJsonAsync<WeatherResponse>();
        Assert.Equal("available", response!.Status);
        Assert.Equal(7, response.Days.Length);
        Assert.NotNull(response.FetchedAtUtc);
        Assert.Equal(DateTimeKind.Utc, response.FetchedAtUtc.Value.Kind);
        Assert.Equal(1, provider.Calls);
        var json = await filled.Content.ReadAsStringAsync();
        Assert.DoesNotContain("lease", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", json, StringComparison.OrdinalIgnoreCase);
        fixture.Clock.Now = DateTimeOffset.Parse("2026-11-07T20:29:59Z");
        using var beforeMidnight = await client.GetAsync("/api/weather");
        Assert.Equal(TimeSpan.FromSeconds(1), beforeMidnight.Headers.CacheControl!.MaxAge);
        fixture.Clock.Now = fixture.Clock.Now.AddSeconds(1);
        using var nextDay = await client.GetAsync("/api/weather?checkIn=2027-04-01&checkOut=2027-04-07");
        var nextForecast = await nextDay.Content.ReadFromJsonAsync<WeatherResponse>();
        Assert.Equal(new DateOnly(2026, 11, 8), nextForecast!.Days[0].Date);
        Assert.Equal(7, nextForecast.Days.Length);
        Assert.Equal("stale", nextForecast.Status);
        Assert.Equal(TimeSpan.FromMinutes(30), nextDay.Headers.CacheControl!.MaxAge);
        Assert.Equal(1, provider.Calls);
        await app.StopAsync();
    }

    private sealed class CountingProvider(WeatherDatabase fixture) : IWeatherProvider
    {
        public bool IsConfigured => true;
        public int Calls;
        public Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(fixture.Snapshot());
        }
    }
}
