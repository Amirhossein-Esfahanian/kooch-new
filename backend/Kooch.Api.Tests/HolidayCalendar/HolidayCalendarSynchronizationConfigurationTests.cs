using Kooch.Api.Services.Holidays;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Kooch.Api.Tests.HolidayCalendar;

[Collection("Environment variable configuration")]
public sealed class HolidayCalendarSynchronizationConfigurationTests
{
    private const string EnabledEnvironmentVariable =
        "HolidayCalendar__Synchronization__Enabled";

    [Fact]
    public void CanonicalNestedSection_BindsAllSynchronizationSettings()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:Enabled"] = "true",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:RunOnStartup"] = "false",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:StartupDelaySeconds"] = "17",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:InitialYearsAhead"] = "4",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:SyncDayOfMonth"] = "7",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:SyncHourLocal"] = "5",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:SyncMinuteLocal"] = "30",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:IranTimeZoneId"] = "Asia/Tehran",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:ProviderName"] = "TestProvider",
                [$"{HolidayCalendarSynchronizationOptions.SectionName}:MaximumEventTitleLength"] = "256"
            })
            .Build();

        var options = configuration
            .GetSection(HolidayCalendarSynchronizationOptions.SectionName)
            .Get<HolidayCalendarSynchronizationOptions>();

        Assert.NotNull(options);
        Assert.True(options.Enabled);
        Assert.False(options.RunOnStartup);
        Assert.Equal(17, options.StartupDelaySeconds);
        Assert.Equal(4, options.InitialYearsAhead);
        Assert.Equal(7, options.SyncDayOfMonth);
        Assert.Equal(5, options.SyncHourLocal);
        Assert.Equal(30, options.SyncMinuteLocal);
        Assert.Equal("Asia/Tehran", options.IranTimeZoneId);
        Assert.Equal("TestProvider", options.ProviderName);
        Assert.Equal(256, options.MaximumEventTitleLength);
    }

    [Fact]
    public void Defaults_KeepSynchronizationDisabled()
    {
        var options = new HolidayCalendarSynchronizationOptions();

        Assert.False(options.Enabled);
        Assert.True(options.RunOnStartup);
        Assert.Equal(10, options.StartupDelaySeconds);
        Assert.Equal(2, options.InitialYearsAhead);
        Assert.Equal(1, options.SyncDayOfMonth);
        Assert.Equal(3, options.SyncHourLocal);
        Assert.Equal(0, options.SyncMinuteLocal);
        Assert.Equal("Iran Standard Time", options.IranTimeZoneId);
    }

    [Fact]
    public void CanonicalBinding_DoesNotReadObsoleteTopLevelSection()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["HolidayCalendarSynchronization:Enabled"] = "true",
                ["HolidayCalendarSynchronization:InitialYearsAhead"] = "99"
            })
            .Build();

        var options = configuration
            .GetSection(HolidayCalendarSynchronizationOptions.SectionName)
            .Get<HolidayCalendarSynchronizationOptions>()
            ?? new HolidayCalendarSynchronizationOptions();

        Assert.False(options.Enabled);
        Assert.Equal(2, options.InitialYearsAhead);
    }

    [Fact]
    public void CanonicalEnvironmentVariable_BindsEnabled()
    {
        Assert.Equal(
            EnabledEnvironmentVariable,
            $"{HolidayCalendarSynchronizationOptions.SectionName.Replace(':', '_').Replace("_", "__") }__Enabled");

        var previousValue = Environment.GetEnvironmentVariable(EnabledEnvironmentVariable);
        try
        {
            Environment.SetEnvironmentVariable(EnabledEnvironmentVariable, "true");
            var configuration = new ConfigurationBuilder()
                .AddEnvironmentVariables()
                .Build();

            var options = configuration
                .GetSection(HolidayCalendarSynchronizationOptions.SectionName)
                .Get<HolidayCalendarSynchronizationOptions>();

            Assert.NotNull(options);
            Assert.True(options.Enabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(EnabledEnvironmentVariable, previousValue);
        }
    }
}

[CollectionDefinition("Environment variable configuration", DisableParallelization = true)]
public sealed class EnvironmentVariableConfigurationCollection;
