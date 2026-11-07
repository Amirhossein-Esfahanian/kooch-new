using Kooch.Api.Authentication;
using Kooch.Api.Services.Weather;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ActionConstraints;
using Microsoft.AspNetCore.Routing;

namespace Kooch.Api.Controllers;

[ApiController]
[SuperAdminAuthorize]
[DevelopmentWeatherOnly]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("api/weather/test-live")]
public sealed class WeatherLiveTestController(VisualCrossingWeatherProvider provider, TimeProvider timeProvider) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<WeatherResponse>> Get(CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = await provider.FetchOnceAsync(cancellationToken);
            var days = WeatherForecastWindow.SelectToday(snapshot.Days, timeProvider, 7);
            if (days.Length == 0)
                throw new WeatherProviderException(WeatherProviderFailureKind.Validation, validationRule: WeatherValidationRule.CurrentDayCoverage);
            return Ok(new WeatherResponse("available", null, snapshot.LocationKey, "VisualCrossing",
                "Weather data by Visual Crossing", snapshot.UnitGroup, timeProvider.GetUtcNow().UtcDateTime,
                days));
        }
        catch (WeatherProviderException exception)
        {
            return StatusCode(StatusCodes.Status502BadGateway,
                new WeatherLiveTestFailure(exception.FailureKind.ToString(), exception.HttpStatusCode, exception.ValidationRule?.ToString(),
                    exception.ActualDayCount, exception.MinimumDayCount, exception.MaximumDayCount));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new WeatherLiveTestFailure("Unknown", null));
        }
    }
}

public sealed record WeatherLiveTestFailure(string Category, int? HttpStatusCode, string? ValidationRule = null,
    int? ActualDayCount = null, int? MinimumDayCount = null, int? MaximumDayCount = null);

// Action selection runs before authorization, so even anonymous production requests receive 404.
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
internal sealed class DevelopmentWeatherOnlyAttribute : ActionMethodSelectorAttribute
{
    public override bool IsValidForRequest(RouteContext routeContext, ActionDescriptor action) =>
        routeContext.HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();
}
