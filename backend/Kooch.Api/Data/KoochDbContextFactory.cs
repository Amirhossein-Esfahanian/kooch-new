using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Kooch.Api.Data;

public sealed class KoochDbContextFactory : IDesignTimeDbContextFactory<KoochDbContext>
{
    public KoochDbContext CreateDbContext(string[] args)
    {
        var environment = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environments.Production;
        var configuration = new ConfigurationBuilder()
            .SetBasePath(FindConfigurationBasePath())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile($"appsettings.{environment}.json", optional: true)
            .AddEnvironmentVariables();

        if (string.Equals(environment, Environments.Development, StringComparison.OrdinalIgnoreCase))
        {
            configuration.AddUserSecrets<KoochDbContextFactory>(optional: true);
        }

        var connectionString = configuration.Build().GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection is required for design-time database operations.");
        }

        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        return new KoochDbContext(options);
    }

    private static string FindConfigurationBasePath()
    {
        var currentDirectory = Directory.GetCurrentDirectory();
        var candidates = new[]
        {
            currentDirectory,
            Path.Combine(currentDirectory, "Kooch.Api"),
            AppContext.BaseDirectory
        };

        var basePath = candidates.FirstOrDefault(path =>
            File.Exists(Path.Combine(path, "appsettings.json")));
        return basePath ?? throw new InvalidOperationException(
            "Could not locate appsettings.json for design-time database operations.");
    }
}
