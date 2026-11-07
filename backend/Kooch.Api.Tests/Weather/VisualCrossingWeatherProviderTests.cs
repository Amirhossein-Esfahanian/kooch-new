using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kooch.Api.Services.Weather;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class VisualCrossingWeatherProviderTests
{
    [Fact]
    public async Task ConfigurationKey_IsAcceptedWithoutEnvironmentConfiguration()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Weather:VisualCrossing:ApiKey"] = "fixture-only",
        }).Build();
        var registrations = new ServiceCollection();
        registrations.AddSharedWeather(configuration);
        using var services = registrations.BuildServiceProvider();
        var source = services.GetRequiredService<IWeatherApiKeySource>();
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(Payload()) });
        using var client = new HttpClient(handler);
        var provider = new VisualCrossingWeatherProvider(client,
            services.GetRequiredService<IOptions<WeatherOptions>>(), source, new WeatherTestClock());

        Assert.True(provider.IsConfigured);
        Assert.True(source.GetKey() == "fixture-only");
        var snapshot = await provider.FetchAsync(default);
        Assert.Equal(15, snapshot.Days.Length);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public void KeyResolution_RespectsConfigurationProviderPrecedence()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Weather:VisualCrossing:ApiKey"] = "fixture-default" })
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Weather:VisualCrossing:ApiKey"] = "fixture-override" })
            .Build();
        var source = new ConfigurationWeatherApiKeySource(configuration);
        Assert.True(source.GetKey() == "fixture-override");
    }

    [Fact]
    public async Task DailyRequest_NormalizesOnlyRequiredFields()
    {
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(Payload()) });
        var provider = Create(handler);
        var snapshot = await provider.FetchAsync(default);
        Assert.Equal(15, snapshot.Days.Length);
        Assert.Equal("آفتابی", snapshot.Days[0].Conditions);
        Assert.Equal(10, snapshot.Days[0].MinTemperature);
        Assert.Equal("clear-day", snapshot.Days[0].Icon);
        Assert.True(handler.DailyOnly);
        Assert.Equal("kashan", snapshot.LocationKey);
        Assert.Equal("metric", snapshot.UnitGroup);
        Assert.Equal(new DateOnly(2026, 11, 7), snapshot.Days[0].Date);
        Assert.Equal(new DateOnly(2026, 11, 21), snapshot.Days[^1].Date);
    }

    [Fact]
    public async Task TransientFailure_RetriesWithBoundedAttempts()
    {
        var handler = new Handler(call => call < 2 ? new(HttpStatusCode.ServiceUnavailable) :
            new(HttpStatusCode.OK) { Content = new StringContent(Payload()) });
        await Create(handler, retries: 1).FetchAsync(default);
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task ExhaustedRetries_ExposeOnlySafeError()
    {
        var handler = new Handler(_ => throw new HttpRequestException("Sensitive upstream URI and body"));
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler, retries: 1).FetchAsync(default));
        Assert.Equal(2, handler.Calls);
        Assert.Null(exception.InnerException);
        Assert.Equal("The weather provider request failed.", exception.Message);
        Assert.Equal(WeatherProviderFailureKind.NetworkOrTimeout, exception.FailureKind);
        Assert.Null(exception.HttpStatusCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task PermanentFailure_DoesNotRetryOrReturnUpstreamBody(HttpStatusCode status)
    {
        var handler = new Handler(_ => new(status) { Content = new StringContent("private upstream error") });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler, retries: 2).FetchAsync(default));
        Assert.Equal(1, handler.Calls);
        Assert.DoesNotContain("private", exception.Message);
        Assert.Equal((int)status, exception.HttpStatusCode);
        Assert.Equal(status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
            ? WeatherProviderFailureKind.Authentication : WeatherProviderFailureKind.Http, exception.FailureKind);
        Assert.Null(exception.InnerException);
    }

    [Theory]
    [InlineData("{}", WeatherProviderFailureKind.Parsing)]
    [InlineData("{\"days\":[]}", WeatherProviderFailureKind.Validation)]
    [InlineData("not json", WeatherProviderFailureKind.Parsing)]
    [InlineData("{\"days\":null}", WeatherProviderFailureKind.Parsing)]
    public async Task InvalidPayload_IsRejectedWithoutRetry(string json, WeatherProviderFailureKind expectedKind)
    {
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler, retries: 2).FetchAsync(default));
        Assert.Equal(expectedKind, exception.FailureKind);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task MissingKey_NeverSendsHttpRequest()
    {
        var handler = new Handler(_ => throw new InvalidOperationException());
        var provider = Create(handler, key: null);
        Assert.False(provider.IsConfigured);
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => provider.FetchAsync(default));
        Assert.Equal(WeatherProviderFailureKind.Configuration, exception.FailureKind);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Cancellation_IsPropagatedWithoutRetry()
    {
        var handler = new Handler(_ => throw new InvalidOperationException());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Create(handler).FetchAsync(cancellation.Token));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task OversizedPayload_IsRejected()
    {
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(new string(' ', 262145)) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchAsync(default));
        Assert.Equal(WeatherProviderFailureKind.Parsing, exception.FailureKind);
    }

    [Fact]
    public async Task RequestTimeout_CancelsHttpAndReturnsSafeFailure()
    {
        var handler = new WaitingHandler();
        var provider = new VisualCrossingWeatherProvider(new HttpClient(handler),
            Options.Create(new WeatherOptions { TimeoutSeconds = 1, RetryCount = 0 }), new Keys("fixture-only"), TimeProvider.System);
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => provider.FetchAsync(default));
        Assert.Equal(WeatherProviderFailureKind.NetworkOrTimeout, exception.FailureKind);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("datetime", WeatherProviderFailureKind.Parsing)]
    [InlineData("tempmin", WeatherProviderFailureKind.Parsing)]
    [InlineData("tempmax", WeatherProviderFailureKind.Parsing)]
    [InlineData("precipprob", WeatherProviderFailureKind.Parsing)]
    [InlineData("conditions", WeatherProviderFailureKind.Validation)]
    [InlineData("icon", WeatherProviderFailureKind.Validation)]
    public async Task NullRequiredField_IsRejectedWithoutFabricatingValues(string field, WeatherProviderFailureKind expectedKind)
    {
        var json = JsonNode.Parse(Payload())!;
        json["days"]![0]![field] = null;
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchAsync(default));
        Assert.Equal(expectedKind, exception.FailureKind);
    }

    [Theory]
    [InlineData("cloudy")]
    [InlineData("partly-cloudy-day")]
    [InlineData("rain")]
    [InlineData("snow")]
    public async Task ValidIcon_IsPreservedWithoutChangingProviderMeaning(string icon)
    {
        var json = JsonNode.Parse(Payload())!;
        json["days"]![0]!["icon"] = icon;
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var snapshot = await Create(handler).FetchAsync(default);
        Assert.Equal(icon, snapshot.Days[0].Icon);
    }

    [Fact]
    public async Task NonconsecutiveDates_AreCategorizedAsValidationFailure()
    {
        var json = JsonNode.Parse(Payload())!;
        json["days"]![1]!["datetime"] = "2026-11-09";
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchAsync(default));
        Assert.Equal(WeatherProviderFailureKind.Validation, exception.FailureKind);
        Assert.Equal(WeatherValidationRule.DateSequence, exception.ValidationRule);
    }

    [Theory]
    [InlineData("tempmin", "-101", WeatherValidationRule.TemperatureBounds)]
    [InlineData("tempmax", "71", WeatherValidationRule.TemperatureBounds)]
    [InlineData("tempmin", "21", WeatherValidationRule.TemperatureOrder)]
    [InlineData("precipprob", "-1", WeatherValidationRule.PrecipitationProbability)]
    [InlineData("precipprob", "101", WeatherValidationRule.PrecipitationProbability)]
    [InlineData("conditions", "null", WeatherValidationRule.ConditionsMissing)]
    [InlineData("conditions", "\"\"", WeatherValidationRule.ConditionsMissing)]
    [InlineData("icon", "null", WeatherValidationRule.IconMissing)]
    [InlineData("icon", "\"\"", WeatherValidationRule.IconMissing)]
    [InlineData("icon", "\"clear_day\"", WeatherValidationRule.IconFormat)]
    [InlineData("icon", "\"Clear-day\"", WeatherValidationRule.IconFormat)]
    [InlineData("conditions", "\"fixture-only\"", WeatherValidationRule.SensitiveContent)]
    public async Task ValidationFailure_IdentifiesTheExactRuleWithoutReturningProviderValues(
        string field, string value, WeatherValidationRule expected)
    {
        var json = JsonNode.Parse(Payload())!;
        json["days"]![0]![field] = JsonNode.Parse(value);
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchOnceAsync(default));
        Assert.Equal(WeatherProviderFailureKind.Validation, exception.FailureKind);
        Assert.Equal(expected, exception.ValidationRule);
        Assert.Null(exception.HttpStatusCode);
        Assert.Null(exception.InnerException);
        Assert.Equal("The weather provider request failed.", exception.Message);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(16)]
    public async Task WrongDayCount_IsIdentifiedWithoutRelaxingTheForecastContract(int count)
    {
        var json = JsonNode.Parse(Payload())!;
        var days = json["days"]!.AsArray();
        if (count == 16) days.Add(days[^1]!.DeepClone());
        else while (days.Count > count) days.RemoveAt(days.Count - 1);
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchOnceAsync(default));
        Assert.Equal(WeatherValidationRule.ForecastDayCount, exception.ValidationRule);
        Assert.Equal(count, exception.ActualDayCount);
        Assert.Equal(7, exception.MinimumDayCount);
        Assert.Equal(15, exception.MaximumDayCount);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(8)]
    [InlineData(14)]
    [InlineData(15)]
    public async Task AvailableConsecutiveForecast_AcceptsSufficientDaysWithoutRequiringExactlyFifteen(int count)
    {
        var json = JsonNode.Parse(Payload())!;
        var days = json["days"]!.AsArray();
        while (days.Count > count) days.RemoveAt(days.Count - 1);
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var result = await Create(handler).FetchOnceAsync(default);
        Assert.Equal(count, result.Days.Length);
        Assert.Equal(new DateOnly(2026, 11, 7), result.Days[0].Date);
    }

    [Theory]
    [InlineData("2026-11-07T20:29:59Z", "2026-11-07", "2026-11-21")]
    [InlineData("2026-11-07T20:30:00Z", "2026-11-08", "2026-11-22")]
    public async Task RequestRange_IsAnchoredToTehranToday_NotUtcOrBookingDates(string utc, string start, string end)
    {
        var clock = new WeatherTestClock { Now = DateTimeOffset.Parse(utc) };
        var json = JsonNode.Parse(Payload())!;
        for (var index = 0; index < 15; index++)
            json["days"]![index]!["datetime"] = DateOnly.Parse(start).AddDays(index).ToString("yyyy-MM-dd");
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var provider = new VisualCrossingWeatherProvider(new HttpClient(handler), Options.Create(new WeatherOptions()),
            new Keys("fixture-only"), clock);
        var forecast = await provider.FetchOnceAsync(default);
        Assert.Equal(DateOnly.Parse(start), forecast.Days[0].Date);
        Assert.EndsWith("/" + start + "/" + end, handler.Path);
    }

    [Fact]
    public async Task FutureOrPastStartingForecast_IsRejectedInsteadOfBeingRelabeledToday()
    {
        var json = JsonNode.Parse(Payload())!;
        for (var index = 0; index < 15; index++)
            json["days"]![index]!["datetime"] = new DateOnly(2026, 11, 8).AddDays(index).ToString("yyyy-MM-dd");
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchOnceAsync(default));
        Assert.Equal(WeatherValidationRule.StartDate, exception.ValidationRule);
    }

    [Theory]
    [InlineData("conditions", 501, WeatherValidationRule.ConditionsLength)]
    [InlineData("icon", 81, WeatherValidationRule.IconLength)]
    public async Task OverlongFields_HaveDistinctSafeRules(string field, int length, WeatherValidationRule expected)
    {
        var json = JsonNode.Parse(Payload())!;
        json["days"]![0]![field] = new string('a', length);
        var handler = new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent(json.ToJsonString()) });
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler).FetchOnceAsync(default));
        Assert.Equal(expected, exception.ValidationRule);
    }

    [Fact]
    public async Task ExhaustedHttpRetries_PreserveOnlySafeStatusAndCategory()
    {
        var handler = new Handler(_ => new(HttpStatusCode.ServiceUnavailable));
        var exception = await Assert.ThrowsAsync<WeatherProviderException>(() => Create(handler, retries: 1).FetchAsync(default));
        Assert.Equal(2, handler.Calls);
        Assert.Equal(WeatherProviderFailureKind.Http, exception.FailureKind);
        Assert.Equal(503, exception.HttpStatusCode);
    }

    private static VisualCrossingWeatherProvider Create(Handler handler, int retries = 0, string? key = "fixture-only") =>
        new(new HttpClient(handler), Options.Create(new WeatherOptions { RetryCount = retries }), new Keys(key), new WeatherTestClock());

    internal static string Payload() => JsonSerializer.Serialize(new
    {
        timezone = "Asia/Tehran",
        days = Enumerable.Range(0, 15).Select(index => new
        {
            datetime = new DateOnly(2026, 11, 7).AddDays(index).ToString("yyyy-MM-dd"),
            tempmin = 10, tempmax = 20, precipprob = 5, conditions = "آفتابی", icon = "clear-day",
            unused = "not normalized"
        })
    });

    private sealed class Keys(string? key) : IWeatherApiKeySource { public string? GetKey() => key; }
    private sealed class WaitingHandler : HttpMessageHandler
    {
        public int Calls;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return new(HttpStatusCode.OK);
        }
    }
    private sealed class Handler(Func<int, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls;
        public bool DailyOnly;
        public string? Path;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            var query = request.RequestUri!.Query;
            Path = request.RequestUri.AbsolutePath;
            DailyOnly = request.RequestUri.Scheme == "https" && Path.EndsWith("/2026-11-07/2026-11-21") &&
                query.Contains("include=days") && query.Contains("lang=fa") && query.Contains("unitGroup=metric") &&
                query.Contains("elements=datetime,tempmin,tempmax,precipprob,conditions,icon");
            return Task.FromResult(respond(Calls));
        }
    }
}
