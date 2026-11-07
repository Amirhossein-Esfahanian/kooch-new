using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Services.Weather;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherLiveTestHttpTests
{
    [Theory]
    [InlineData("Production", null, HttpStatusCode.NotFound)]
    [InlineData("Production", "SuperAdmin", HttpStatusCode.NotFound)]
    [InlineData("Staging", "SuperAdmin", HttpStatusCode.NotFound)]
    [InlineData("Development", null, HttpStatusCode.Unauthorized)]
    [InlineData("Development", "Client", HttpStatusCode.Forbidden)]
    [InlineData("Development", "AdminAssistant", HttpStatusCode.Forbidden)]
    public async Task EnvironmentAndExistingSuperAdminPolicy_BlockProviderCalls(string environment, string? role, HttpStatusCode expected)
    {
        await using var fixture = await Fixture.CreateAsync(environment, role);
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(0, fixture.Handler.Calls);
    }

    [Fact]
    public async Task DirectForecast_IsNoStore_SevenDays_WithoutAnyDatabaseServices()
    {
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin");
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var forecast = await response.Content.ReadFromJsonAsync<WeatherResponse>();
        Assert.Equal("available", forecast!.Status);
        Assert.Equal("kashan", forecast.LocationKey);
        Assert.Equal(7, forecast.Days.Length);
        Assert.Equal(12, forecast.Days[0].MinTemperature);
        Assert.NotNull(forecast.FetchedAtUtc);
        Assert.Equal(1, fixture.Handler.Calls);
    }

    [Fact]
    public async Task BookingSearchQuery_DoesNotSelectTheWeatherDate()
    {
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin");
        using var response = await fixture.Client.GetAsync("/api/weather/test-live?checkIn=2027-03-01&checkOut=2027-03-07&date=2028-01-01");
        var forecast = await response.Content.ReadFromJsonAsync<WeatherResponse>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new DateOnly(2026, 11, 7), forecast!.Days[0].Date);
    }

    [Fact]
    public async Task InsufficientForecast_ReportsActualAndPermittedCountsWithoutProviderData()
    {
        var json = JsonNode.Parse(VisualCrossingWeatherProviderTests.Payload())!;
        var days = json["days"]!.AsArray();
        while (days.Count > 6) days.RemoveAt(days.Count - 1);
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin", body: json.ToJsonString());
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        var error = await response.Content.ReadFromJsonAsync<WeatherLiveTestFailure>();
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal("ForecastDayCount", error!.ValidationRule);
        Assert.Equal(6, error.ActualDayCount);
        Assert.Equal(7, error.MinimumDayCount);
        Assert.Equal(15, error.MaximumDayCount);
    }

    [Theory]
    [InlineData(401, "Authentication")]
    [InlineData(503, "Http")]
    [InlineData(200, "Parsing")]
    public async Task Failure_IsSanitized_AndNeverRetries(int upstreamStatus, string category)
    {
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin", upstreamStatus, "private upstream body");
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var error = await response.Content.ReadFromJsonAsync<WeatherLiveTestFailure>();
        Assert.Equal(category, error!.Category);
        Assert.Equal(upstreamStatus == 200 ? (int?)null : upstreamStatus, error.HttpStatusCode);
        Assert.Equal(1, fixture.Handler.Calls);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("private upstream body", body);
        Assert.DoesNotContain("fixture-provider-key", body);
        Assert.DoesNotContain("https://", body);
    }

    [Fact]
    public async Task MissingKey_FailsWithoutAnExternalRequest()
    {
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin", key: null);
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal("Configuration", (await response.Content.ReadFromJsonAsync<WeatherLiveTestFailure>())!.Category);
        Assert.Equal(0, fixture.Handler.Calls);
    }

    [Theory]
    [InlineData("tempmax", "71", "TemperatureBounds")]
    [InlineData("icon", "\"clear_day\"", "IconFormat")]
    [InlineData("conditions", "\"fixture-provider-key\"", "SensitiveContent")]
    public async Task ValidationResponse_ContainsSafeRule_NotRawPayloadOrAnInventedUpstreamStatus(
        string field, string value, string expectedRule)
    {
        var json = JsonNode.Parse(VisualCrossingWeatherProviderTests.Payload())!;
        json["days"]![0]![field] = JsonNode.Parse(value);
        await using var fixture = await Fixture.CreateAsync("Development", "SuperAdmin", body: json.ToJsonString());
        using var response = await fixture.Client.GetAsync("/api/weather/test-live");
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<WeatherLiveTestFailure>();
        Assert.Equal("Validation", error!.Category);
        Assert.Equal(expectedRule, error.ValidationRule);
        Assert.Null(error.HttpStatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Equal(1, fixture.Handler.Calls);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("fixture-provider-key", text);
        Assert.DoesNotContain("conditions", text);
        Assert.DoesNotContain("https://", text);
    }

    private sealed class Fixture(WebApplication app, HttpClient client, Handler handler) : IAsyncDisposable
    {
        public HttpClient Client => client;
        public Handler Handler => handler;

        public static async Task<Fixture> CreateAsync(string environment, string? role, int status = 200,
            string? body = null, string? key = "fixture-provider-key")
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
            builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddControllers().AddApplicationPart(typeof(WeatherLiveTestController).Assembly);
            var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('k', 64)));
            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true, ValidIssuer = "weather-fixture", ValidateAudience = true,
                    ValidAudience = "weather-fixture", ValidateLifetime = true, ValidateIssuerSigningKey = true,
                    IssuerSigningKey = signingKey
                });
            builder.Services.AddAuthorization(options => options.AddPolicy(AuthorizationPolicies.SuperAdmin,
                policy => policy.RequireAuthenticatedUser().RequireRole("SuperAdmin")));
            var handler = new Handler(status, body);
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Weather:VisualCrossing:ApiKey"] = key
            }).Build();
            var clock = new WeatherTestClock();
            builder.Services.AddSingleton<TimeProvider>(clock);
            builder.Services.AddSingleton(new VisualCrossingWeatherProvider(new HttpClient(handler),
                Options.Create(new WeatherOptions()), new ConfigurationWeatherApiKeySource(configuration), clock));
            // No WeatherService, store, DbContext or worker: the diagnostic must not depend on any of them.
            var app = builder.Build();
            app.UseAuthentication(); app.UseAuthorization(); app.MapControllers();
            await app.StartAsync();
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            var client = new HttpClient { BaseAddress = new Uri(address) };
            if (role is not null)
            {
                var token = new JwtSecurityToken("weather-fixture", "weather-fixture",
                    [new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, role)],
                    expires: DateTime.UtcNow.AddMinutes(5), signingCredentials: new(signingKey, SecurityAlgorithms.HmacSha256));
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(token));
            }
            return new(app, client, handler);
        }

        public async ValueTask DisposeAsync()
        {
            client.Dispose(); handler.Dispose(); await app.StopAsync(); await app.DisposeAsync();
        }
    }

    private sealed class Handler(int status, string? body) : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            var today = new DateOnly(2026, 11, 7);
            var payload = body ?? JsonSerializer.Serialize(new
            {
                timezone = "Asia/Tehran",
                days = Enumerable.Range(0, 15).Select(index => new
                {
                    datetime = today.AddDays(index).ToString("yyyy-MM-dd"), tempmin = 12, tempmax = 24,
                    precipprob = 0, conditions = "آفتابی", icon = "clear-day"
                })
            });
            return Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(payload) });
        }
    }
}
