using System.Reflection;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Calendar;
using Kooch.Api.Services.Holidays;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

public sealed class CalendarControllerTests
{
    [Fact]
    public async Task GetDays_ValidOneDayRangeReturnsResponse()
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);

        var action = await controller.GetDays("2026-03-21", "2026-03-21", CancellationToken.None);

        var result = Assert.IsType<OkObjectResult>(action.Result);
        Assert.Same(service.Response, result.Value);
        Assert.Equal(new DateOnly(2026, 3, 21), service.From);
        Assert.Equal(service.From, service.To);
    }

    [Fact]
    public async Task GetDays_ValidNinetyThreeDayInclusiveRangeReturnsResponse()
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);
        var from = new DateOnly(2026, 1, 1);
        var to = from.AddDays(CalendarController.MaximumInclusiveRangeDays - 1);

        var action = await controller.GetDays(
            from.ToString("yyyy-MM-dd"),
            to.ToString("yyyy-MM-dd"),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(action.Result);
        Assert.Equal(1, service.CallCount);
    }

    [Fact]
    public async Task GetDays_MoreThanNinetyThreeInclusiveDaysReturnsBadRequest()
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);
        var from = new DateOnly(2026, 1, 1);
        var to = from.AddDays(CalendarController.MaximumInclusiveRangeDays);

        var action = await controller.GetDays(
            from.ToString("yyyy-MM-dd"),
            to.ToString("yyyy-MM-dd"),
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(action.Result);
        Assert.Equal(0, service.CallCount);
    }

    [Fact]
    public async Task GetDays_FromAfterToReturnsBadRequest()
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);

        var action = await controller.GetDays("2026-03-22", "2026-03-21", CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(action.Result);
        Assert.Equal(0, service.CallCount);
    }

    [Theory]
    [InlineData(null, "2026-03-21")]
    [InlineData("2026-03-21", null)]
    [InlineData("not-a-date", "2026-03-21")]
    [InlineData("03/21/2026", "2026-03-21")]
    [InlineData("2026-3-21", "2026-03-21")]
    public async Task GetDays_MissingOrNonIsoDateReturnsBadRequest(string? from, string? to)
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);

        var action = await controller.GetDays(from, to, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(action.Result);
        Assert.Equal(0, service.CallCount);
    }

    [Fact]
    public async Task GetDays_PassesCancellationToken()
    {
        var service = new RecordingQueryService();
        var controller = new CalendarController(service);
        using var cancellation = new CancellationTokenSource();

        await controller.GetDays("2026-03-21", "2026-03-21", cancellation.Token);

        Assert.Equal(cancellation.Token, service.CancellationToken);
    }

    [Fact]
    public void ResponseContract_DoesNotExposeInternalHolidayFields()
    {
        var response = new HolidayCalendarDaysResponse(
            new DateOnly(2026, 3, 21),
            new DateOnly(2026, 3, 21),
            true,
            1405,
            1407,
            new DateTime(2026, 7, 28, 6, 0, 0, DateTimeKind.Utc),
            [new HolidayCalendarDayResponse(new DateOnly(2026, 3, 21), 1405, 1, 1, false, true, ["Nowruz"])]);

        var json = JsonSerializer.Serialize(response);

        Assert.DoesNotContain("\"ProviderName\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"NormalizedTitle\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"Source\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"Override\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"Hash\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"Error\"", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"Id\"", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Controller_IsAnonymousGetOnlyEndpoint()
    {
        Assert.NotNull(typeof(CalendarController).GetCustomAttribute<AllowAnonymousAttribute>());
        var action = Assert.Single(
            typeof(CalendarController).GetMethods(),
            method => method.Name == nameof(CalendarController.GetDays));
        Assert.Equal("days", action.GetCustomAttribute<HttpGetAttribute>()?.Template);
        Assert.DoesNotContain(
            typeof(CalendarController).GetMethods(BindingFlags.Instance | BindingFlags.Public),
            method => method.GetCustomAttributes().Any(attribute =>
                attribute is HttpPostAttribute or HttpPutAttribute or HttpDeleteAttribute or HttpPatchAttribute));
    }

    private sealed class RecordingQueryService : IHolidayCalendarQueryService
    {
        public HolidayCalendarDaysResponse Response { get; } = new(
            new DateOnly(2026, 3, 21),
            new DateOnly(2026, 3, 21),
            false,
            null,
            null,
            null,
            []);

        public int CallCount { get; private set; }
        public DateOnly From { get; private set; }
        public DateOnly To { get; private set; }
        public CancellationToken CancellationToken { get; private set; }

        public Task<HolidayCalendarDaysResponse> GetDaysAsync(
            DateOnly from,
            DateOnly to,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            From = from;
            To = to;
            CancellationToken = cancellationToken;
            return Task.FromResult(Response);
        }
    }
}
