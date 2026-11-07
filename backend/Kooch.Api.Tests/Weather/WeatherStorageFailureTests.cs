using System.Data.Common;
using System.Reflection;
using Kooch.Api.Data;
using Kooch.Api.Services.Weather;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests.Weather;

public sealed class WeatherStorageFailureTests
{
    [Fact]
    public async Task MissingSqlServerTable_ReportsSetupRequiredWithoutOpeningDatabaseOrCallingProvider()
    {
        var interceptor = new MissingTableInterceptor();
        await using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=ModelOnly;Integrated Security=True;TrustServerCertificate=True")
            .AddInterceptors(interceptor).Options);
        var service = new WeatherService(new WeatherForecastStore(context), new NeverCalledProvider(),
            Options.Create(new WeatherOptions { Enabled = true }), TimeProvider.System, NullLogger<WeatherService>.Instance);
        Assert.Equal("setup_required", (await service.GetAsync(default)).UnavailableReason);
        Assert.Equal("setup_required", await service.RefreshAsync(default));
        Assert.Equal(2, interceptor.BlockedOpenCount);
    }

    private sealed class NeverCalledProvider : IWeatherProvider
    {
        public bool IsConfigured => true;
        public Task<WeatherSnapshot> FetchAsync(CancellationToken cancellationToken) => throw new InvalidOperationException("Provider must not run.");
    }

    private sealed class MissingTableInterceptor : DbConnectionInterceptor
    {
        public int BlockedOpenCount;
        public override ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            BlockedOpenCount++;
            var constructor = typeof(SqlError).GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic)
                .Single(candidate => candidate.GetParameters().Length == 9);
            var error = (SqlError)constructor.Invoke([208, (byte)1, (byte)16, "fixture", "Missing cache table", "", 1, (uint)0, null]);
            var errors = (SqlErrorCollection)Activator.CreateInstance(typeof(SqlErrorCollection), nonPublic: true)!;
            typeof(SqlErrorCollection).GetMethod("Add", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(errors, [error]);
            throw (SqlException)typeof(SqlException).GetMethod("CreateException", BindingFlags.Static | BindingFlags.NonPublic,
                null, [typeof(SqlErrorCollection), typeof(string)], null)!.Invoke(null, [errors, "16.0"])!;
        }
    }
}
