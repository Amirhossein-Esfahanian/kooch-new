namespace Kooch.Api.Services.Weather;

public static class WeatherServiceRegistration
{
    public static IServiceCollection AddSharedWeather(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<WeatherOptions>(configuration.GetSection(WeatherOptions.SectionName));
        services.AddSingleton<IWeatherApiKeySource, EnvironmentWeatherApiKeySource>();
        services.AddHttpClient<IWeatherProvider, VisualCrossingWeatherProvider>(client => client.Timeout = Timeout.InfiniteTimeSpan)
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
            .RemoveAllLoggers();
        services.AddScoped<WeatherForecastStore>();
        services.AddScoped<WeatherService>();
        return services;
    }
}
