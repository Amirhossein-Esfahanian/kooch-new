using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kooch.Api.Integrations.PnlDev;
using Kooch.Api.Services.Holidays;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class PnlDevHolidayProviderTests
{
    private const int FixtureYear = 1405;
    private const string FixtureFileName = "pnldev-1405.json";

    [Fact]
    public async Task FetchYearAsync_UsesAnnualEndpointAndNormalizesCapturedFixture()
    {
        Uri? requestedUri = null;
        var provider = CreateProvider((request, _) =>
        {
            requestedUri = request.RequestUri;
            return Task.FromResult(JsonResponse(FixtureJson));
        });

        var result = await provider.FetchYearAsync(FixtureYear);
        var fixtureRoot = ParseFixture();
        var rawDays = EnumerateDays(fixtureRoot).ToArray();
        var rawHolidayCount = rawDays.Count(day => day["holiday"]!.GetValue<bool>());

        Assert.Equal("https://pnldev.com/api/calender?year=1405", requestedUri?.AbsoluteUri);
        Assert.Equal("PNLdev", result.ProviderName);
        Assert.Equal(FixtureYear, result.RequestedSolarYear);
        Assert.Equal(FixtureYear, result.SourceSolarYear);
        Assert.Equal(365, rawDays.Length);
        Assert.Equal(rawHolidayCount, result.Holidays.Count);
        Assert.All(result.Holidays, holiday =>
        {
            Assert.Equal(FixtureYear, holiday.SolarYear);
            Assert.True(holiday.IsWeeklyHoliday ^ holiday.IsOfficialHoliday);
        });

        AssertRawDate(rawDays[0], 1405, 1, 1, new DateOnly(2026, 3, 21));
        AssertRawDate(rawDays[^1], 1405, 12, 29, new DateOnly(2027, 3, 20));
    }

    [Fact]
    public async Task FetchYearAsync_ClassifiesFridaysWithoutInferringOfficialOverlap()
    {
        var result = await CreateFixtureProvider().FetchYearAsync(FixtureYear);
        var fridayWithProviderTitle = Assert.Single(result.Holidays.Where(day =>
            day.SolarMonth == 1 && day.SolarDay == 7));

        Assert.Equal(DayOfWeek.Friday, fridayWithProviderTitle.DayOfWeek);
        Assert.True(fridayWithProviderTitle.IsWeeklyHoliday);
        Assert.False(fridayWithProviderTitle.IsOfficialHoliday);
        Assert.Empty(fridayWithProviderTitle.OccasionTitles);
        Assert.All(result.Holidays.Where(day => day.DayOfWeek == DayOfWeek.Friday), day =>
        {
            Assert.True(day.IsWeeklyHoliday);
            Assert.False(day.IsOfficialHoliday);
            Assert.Empty(day.OccasionTitles);
        });
    }

    [Fact]
    public async Task FetchYearAsync_PreservesTrimmedDistinctTitlesForOfficialNonFridayHolidays()
    {
        var payload = MutateFixture(root =>
        {
            var events = GetDay(root, 1, 1)["event"]!.AsArray();
            events.Clear();
            events.Add("  عنوان رسمی  ");
            events.Add("عنوان رسمی");
            events.Add(" ");
        });
        var result = await CreateJsonProvider(payload).FetchYearAsync(FixtureYear);
        var holiday = Assert.Single(result.Holidays.Where(day =>
            day.SolarMonth == 1 && day.SolarDay == 1));

        Assert.False(holiday.IsWeeklyHoliday);
        Assert.True(holiday.IsOfficialHoliday);
        Assert.Equal(new[] { "عنوان رسمی" }, holiday.OccasionTitles);
    }

    [Fact]
    public async Task FetchYearAsync_ReturnsReadOnlySnapshots()
    {
        var result = await CreateFixtureProvider().FetchYearAsync(FixtureYear);
        var firstHoliday = result.Holidays[0];

        Assert.True(Assert.IsAssignableFrom<ICollection<HolidayProviderDay>>(result.Holidays).IsReadOnly);
        Assert.True(Assert.IsAssignableFrom<ICollection<string>>(firstHoliday.OccasionTitles).IsReadOnly);
    }

    [Fact]
    public async Task FetchYearAsync_AcceptsCompleteLeapYearPayload()
    {
        var payload = CreateSyntheticYearPayload(1403);
        var provider = CreateJsonProvider(payload);

        var result = await provider.FetchYearAsync(1403);

        Assert.Equal(1403, result.SourceSolarYear);
        Assert.All(result.Holidays, holiday => Assert.True(holiday.IsWeeklyHoliday));
        Assert.Equal(366, EnumerateDays(JsonNode.Parse(payload)!.AsObject()).Count());
    }

    [Fact]
    public async Task FetchYearAsync_RejectsMalformedJsonAsSchemaFailure()
    {
        var provider = CreateJsonProvider("{\"status\":true,");

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.SchemaOrDeserialization, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsMissingRequiredDayFieldsAsSchemaFailure()
    {
        var payload = MutateFixture(root => GetDay(root, 1, 1).Remove("gregorian"));
        var provider = CreateJsonProvider(payload);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.SchemaOrDeserialization, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsUnsuccessfulProviderStatus()
    {
        var provider = CreateJsonProvider("{\"status\":false,\"result\":\"provider error\"}");

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Validation, exception.FailureKind);
        Assert.DoesNotContain("provider error", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsIncompleteYear()
    {
        var payload = MutateFixture(root =>
            root["result"]!["12"]!.AsObject().Remove("29"));
        var provider = CreateJsonProvider(payload);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Validation, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsDuplicateGregorianDates()
    {
        var payload = MutateFixture(root =>
        {
            GetDay(root, 1, 2)["gregorian"] = GetDay(root, 1, 1)["gregorian"]!.DeepClone();
        });
        var provider = CreateJsonProvider(payload);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Validation, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsIncorrectWeekday()
    {
        var payload = MutateFixture(root =>
            GetDay(root, 1, 1)["gregorian"]!["dayWeek"] = "Sun");
        var provider = CreateJsonProvider(payload);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Validation, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_RejectsFridayNotMarkedAsHoliday()
    {
        var payload = MutateFixture(root => GetDay(root, 1, 7)["holiday"] = false);
        var provider = CreateJsonProvider(payload);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Validation, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_MapsHttpFailureWithoutIncludingResponseBody()
    {
        var provider = CreateProvider((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("sensitive provider event body")
        }));

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Http, exception.FailureKind);
        Assert.Equal(HttpStatusCode.BadGateway, exception.StatusCode);
        Assert.DoesNotContain("sensitive", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FetchYearAsync_MapsNetworkFailure()
    {
        var provider = CreateProvider((_, _) =>
            throw new HttpRequestException("network details"));

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.NetworkOrTimeout, exception.FailureKind);
        Assert.DoesNotContain("network details", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FetchYearAsync_MapsInternalTimeout()
    {
        var provider = CreateProvider(
            async (_, cancellationToken) =>
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                return JsonResponse(FixtureJson);
            },
            timeoutSeconds: 1);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.NetworkOrTimeout, exception.FailureKind);
    }

    [Fact]
    public async Task FetchYearAsync_PreservesCallerCancellation()
    {
        var provider = CreateProvider(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return JsonResponse(FixtureJson);
        });
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            provider.FetchYearAsync(FixtureYear, cancellationSource.Token));
    }

    [Fact]
    public async Task FetchYearAsync_DoesNotSendWhenDisabled()
    {
        var requestSent = false;
        var provider = CreateProvider(
            (_, _) =>
            {
                requestSent = true;
                return Task.FromResult(JsonResponse(FixtureJson));
            },
            enabled: false);

        var exception = await Assert.ThrowsAsync<HolidayProviderException>(() =>
            provider.FetchYearAsync(FixtureYear));

        Assert.Equal(HolidayProviderFailureKind.Disabled, exception.FailureKind);
        Assert.False(requestSent);
    }

    private static PnlDevHolidayProvider CreateFixtureProvider()
    {
        return CreateJsonProvider(FixtureJson);
    }

    private static PnlDevHolidayProvider CreateJsonProvider(string json)
    {
        return CreateProvider((_, _) => Task.FromResult(JsonResponse(json)));
    }

    private static PnlDevHolidayProvider CreateProvider(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responseFactory,
        int timeoutSeconds = 30,
        bool enabled = true)
    {
        var httpClient = new HttpClient(new StubHttpMessageHandler(responseFactory));
        var options = Options.Create(new PnlDevOptions
        {
            BaseUrl = "https://pnldev.com/api/calender",
            RequestTimeoutSeconds = timeoutSeconds,
            Enabled = enabled
        });

        return new PnlDevHolidayProvider(httpClient, options);
    }

    private static HttpResponseMessage JsonResponse(string json)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
    }

    private static JsonObject ParseFixture()
    {
        return JsonNode.Parse(FixtureJson)!.AsObject();
    }

    private static string MutateFixture(Action<JsonObject> mutation)
    {
        var root = ParseFixture();
        mutation(root);
        return root.ToJsonString();
    }

    private static JsonObject GetDay(JsonObject root, int month, int day)
    {
        return root["result"]![month.ToString(CultureInfo.InvariantCulture)]!
            [day.ToString(CultureInfo.InvariantCulture)]!.AsObject();
    }

    private static IEnumerable<JsonObject> EnumerateDays(JsonObject root)
    {
        foreach (var month in root["result"]!.AsObject())
        {
            foreach (var day in month.Value!.AsObject())
            {
                yield return day.Value!.AsObject();
            }
        }
    }

    private static void AssertRawDate(
        JsonObject day,
        int solarYear,
        int solarMonth,
        int solarDay,
        DateOnly gregorianDate)
    {
        Assert.Equal(solarYear, day["solar"]!["year"]!.GetValue<int>());
        Assert.Equal(solarMonth, day["solar"]!["month"]!.GetValue<int>());
        Assert.Equal(solarDay, day["solar"]!["day"]!.GetValue<int>());
        Assert.Equal(gregorianDate.Year, day["gregorian"]!["year"]!.GetValue<int>());
        Assert.Equal(gregorianDate.Month, day["gregorian"]!["month"]!.GetValue<int>());
        Assert.Equal(gregorianDate.Day, day["gregorian"]!["day"]!.GetValue<int>());
    }

    private static string CreateSyntheticYearPayload(int solarYear)
    {
        var calendar = new PersianCalendar();
        var result = new JsonObject();

        for (var month = 1; month <= 12; month++)
        {
            var monthNode = new JsonObject();
            var daysInMonth = calendar.GetDaysInMonth(solarYear, month);
            for (var day = 1; day <= daysInMonth; day++)
            {
                var date = DateOnly.FromDateTime(calendar.ToDateTime(solarYear, month, day, 0, 0, 0, 0));
                monthNode[day.ToString(CultureInfo.InvariantCulture)] = new JsonObject
                {
                    ["solar"] = CreateDateNode(solarYear, month, day, ToSolarWeekday(date.DayOfWeek)),
                    ["moon"] = CreateDateNode(1446, 1, 1, null),
                    ["gregorian"] = CreateDateNode(
                        date.Year,
                        date.Month,
                        date.Day,
                        date.ToString("ddd", CultureInfo.InvariantCulture)),
                    ["holiday"] = date.DayOfWeek == DayOfWeek.Friday,
                    ["event"] = new JsonArray()
                };
            }

            result[month.ToString(CultureInfo.InvariantCulture)] = monthNode;
        }

        return new JsonObject
        {
            ["status"] = true,
            ["result"] = result
        }.ToJsonString();
    }

    private static JsonObject CreateDateNode(int year, int month, int day, string? dayOfWeek)
    {
        return new JsonObject
        {
            ["day"] = day,
            ["month"] = month,
            ["year"] = year,
            ["dayWeek"] = dayOfWeek
        };
    }

    private static string ToSolarWeekday(DayOfWeek dayOfWeek)
    {
        return dayOfWeek switch
        {
            DayOfWeek.Saturday => "ش",
            DayOfWeek.Sunday => "ی",
            DayOfWeek.Monday => "د",
            DayOfWeek.Tuesday => "س",
            DayOfWeek.Wednesday => "چ",
            DayOfWeek.Thursday => "پ",
            DayOfWeek.Friday => "ج",
            _ => throw new ArgumentOutOfRangeException(nameof(dayOfWeek))
        };
    }

    private static string FixtureJson => File.ReadAllText(Path.Combine(
        AppContext.BaseDirectory,
        "HolidayCalendar",
        "Fixtures",
        FixtureFileName));

    private sealed class StubHttpMessageHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responseFactory)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            return responseFactory(request, cancellationToken);
        }
    }
}
