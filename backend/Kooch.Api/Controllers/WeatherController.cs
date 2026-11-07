using Kooch.Api.Services.Weather;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/weather")]
public sealed class WeatherController(WeatherService weather) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [ResponseCache(Duration = 1800, Location = ResponseCacheLocation.Any)]
    public Task<WeatherResponse> Get(CancellationToken cancellationToken) => weather.GetAsync(cancellationToken);
}
