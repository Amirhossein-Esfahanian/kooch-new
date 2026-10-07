using Kooch.Api.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Kooch.Api.Tests;

[Collection("Environment variable configuration")]
public sealed class AutomaticDatabaseMutationsStartupTests
{
    private static readonly string[] WriterNames =
    [
        "HolidayCalendarSyncHostedService",
        "CashbackGrantHostedService",
        "ReservationExpirationHostedService",
        "ReservationApprovalReminderHostedService"
    ];

    [Fact]
    public void MissingConfiguration_KeepsAutomaticMutationsEnabled()
    {
        var configuration = new ConfigurationBuilder().Build();

        Assert.True(new AutomaticDatabaseMutationsOptions().Enabled);
        Assert.True(AutomaticDatabaseMutationsStartup.IsEnabled(configuration));
    }

    [Theory]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void ExplicitConfiguration_ControlsAutomaticMutations(string configured, bool expected)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [$"{AutomaticDatabaseMutationsOptions.SectionName}:Enabled"] = configured
            })
            .Build();

        Assert.Equal(expected, AutomaticDatabaseMutationsStartup.IsEnabled(configuration));
    }

    [Fact]
    public void EnvironmentOverride_DisablesAutomaticMutations()
    {
        const string name = "AutomaticDatabaseMutations__Enabled";
        var previous = Environment.GetEnvironmentVariable(name);
        try
        {
            Environment.SetEnvironmentVariable(name, "false");
            var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();

            Assert.False(AutomaticDatabaseMutationsStartup.IsEnabled(configuration));
        }
        finally
        {
            Environment.SetEnvironmentVariable(name, previous);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void WriterRegistration_RespectsOuterGate(bool enabled)
    {
        var services = new ServiceCollection();

        services.AddWriterHostedServices(enabled);

        var registeredWriters = services
            .Where(descriptor => descriptor.ServiceType == typeof(IHostedService))
            .Select(descriptor => descriptor.ImplementationType?.Name)
            .ToArray();
        Assert.Equal(enabled ? WriterNames : [], registeredWriters);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StartupInitialization_RespectsOuterGate(bool enabled)
    {
        var calls = 0;

        await AutomaticDatabaseMutationsStartup.RunInitializationAsync(enabled, () =>
        {
            calls++;
            return Task.CompletedTask;
        });

        Assert.Equal(enabled ? 1 : 0, calls);
    }
}
