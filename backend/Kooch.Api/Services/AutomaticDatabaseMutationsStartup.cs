using Kooch.Api.Services.Holidays;

namespace Kooch.Api.Services;

public sealed class AutomaticDatabaseMutationsOptions
{
    public const string SectionName = "AutomaticDatabaseMutations";

    public bool Enabled { get; set; } = true;
}

public static class AutomaticDatabaseMutationsStartup
{
    public static bool IsEnabled(IConfiguration configuration) =>
        configuration.GetSection(AutomaticDatabaseMutationsOptions.SectionName)
            .Get<AutomaticDatabaseMutationsOptions>()?.Enabled ?? true;

    public static IServiceCollection AddWriterHostedServices(
        this IServiceCollection services,
        bool enabled)
    {
        if (!enabled) return services;

        services.AddHostedService<HolidayCalendarSyncHostedService>();
        services.AddHostedService<CashbackGrantHostedService>();
        services.AddHostedService<ReservationExpirationHostedService>();
        services.AddHostedService<ReservationApprovalReminderHostedService>();
        return services;
    }

    public static Task RunInitializationAsync(bool enabled, Func<Task> initialize) =>
        enabled ? initialize() : Task.CompletedTask;
}
