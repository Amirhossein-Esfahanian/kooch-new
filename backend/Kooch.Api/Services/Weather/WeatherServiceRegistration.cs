namespace Kooch.Api.Services.Weather;

public static class WeatherServiceRegistration
{
    public static IServiceCollection AddSharedWeather(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<WeatherOptions>(configuration.GetSection(WeatherOptions.SectionName));
        services.AddSingleton<IWeatherApiKeySource>(new ConfigurationWeatherApiKeySource(configuration));
        services.AddHttpClient<VisualCrossingWeatherProvider>(client => client.Timeout = Timeout.InfiniteTimeSpan)
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
            .RemoveAllLoggers();
        services.AddTransient<IWeatherProvider>(services => services.GetRequiredService<VisualCrossingWeatherProvider>());
        services.AddScoped<WeatherForecastStore>();
        services.AddScoped<WeatherService>();
        services.AddHostedService<WeatherRefreshHostedService>();
        return services;
    }
}
