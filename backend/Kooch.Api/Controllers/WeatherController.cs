using Kooch.Api.Services.Weather;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/weather")]
public sealed class WeatherController(WeatherService weather, TimeProvider timeProvider) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public Task<WeatherResponse> Get(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var midnight = IranSiteTime.ToUtc(WeatherForecastWindow.Today(timeProvider).AddDays(1), TimeOnly.MinValue);
        var seconds = Math.Clamp((int)(midnight - now.UtcDateTime).TotalSeconds, 0, 1800);
        Response.Headers.CacheControl = $"public,max-age={seconds}";
        return weather.GetAsync(cancellationToken);
    }
}
