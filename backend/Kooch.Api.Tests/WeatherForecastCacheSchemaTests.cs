using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WeatherForecastCacheSchemaTests
{
    [Fact]
    public void Model_HasUnboundedNullablePayloadAndUniqueLocationKey()
    {
        using var context = CreateModelOnlyContext();
        var entity = context.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(WeatherForecastCache))!;
        var locationKey = entity.FindProperty(nameof(WeatherForecastCache.LocationKey))!;
        var payload = entity.FindProperty(nameof(WeatherForecastCache.NormalizedForecastJson))!;

        Assert.Equal("WeatherForecastCaches", entity.GetTableName());
        Assert.Equal("nvarchar(200)", locationKey.GetColumnType());
        Assert.False(locationKey.IsNullable);
        Assert.Contains(entity.GetIndexes(), index => index.IsUnique && index.Properties.SequenceEqual([locationKey]));
        Assert.True(payload.IsNullable);
        Assert.Equal("nvarchar(max)", payload.GetColumnType());
        Assert.Null(payload.GetMaxLength());
        Assert.True(entity.FindProperty(nameof(WeatherForecastCache.FetchedAtUtc))!.IsNullable);
        Assert.True(entity.FindProperty(nameof(WeatherForecastCache.UpdatedAtUtc))!.IsNullable);
    }

    [Fact]
    public void Model_HasLeaseExpiryAndRowVersionConcurrency()
    {
        using var context = CreateModelOnlyContext();
        var entity = context.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(WeatherForecastCache))!;
        var rowVersion = entity.FindProperty(nameof(WeatherForecastCache.RowVersion))!;

        Assert.Equal("nvarchar(200)", entity.FindProperty(nameof(WeatherForecastCache.LeaseOwner))!.GetColumnType());
        Assert.True(entity.FindProperty(nameof(WeatherForecastCache.LeaseExpiresAtUtc))!.IsNullable);
        Assert.Equal("rowversion", rowVersion.GetColumnType());
        Assert.True(rowVersion.IsConcurrencyToken);
        Assert.Equal(ValueGenerated.OnAddOrUpdate, rowVersion.ValueGenerated);
    }

    [Fact]
    public void Migration_OnlyCreatesCacheTableAndUniqueIndex()
    {
        var migration = new AddWeatherForecastCache();
        Assert.Collection(migration.UpOperations,
            operation =>
            {
                var table = Assert.IsType<CreateTableOperation>(operation);
                Assert.Equal("WeatherForecastCaches", table.Name);
                Assert.Contains(table.Columns, column => column.Name == "NormalizedForecastJson" && column.ColumnType == "nvarchar(max)" && column.IsNullable);
                Assert.Contains(table.Columns, column => column.Name == "FetchedAtUtc" && column.IsNullable);
                Assert.Contains(table.Columns, column => column.Name == "UpdatedAtUtc" && column.IsNullable);
                Assert.Contains(table.Columns, column => column.Name == "LeaseExpiresAtUtc" && column.IsNullable);
                Assert.Contains(table.Columns, column => column.Name == "RowVersion" && column.IsRowVersion);
            },
            operation =>
            {
                var index = Assert.IsType<CreateIndexOperation>(operation);
                Assert.Equal("WeatherForecastCaches", index.Table);
                Assert.Equal(["LocationKey"], index.Columns);
                Assert.True(index.IsUnique);
            });
        Assert.Collection(migration.DownOperations,
            operation => Assert.Equal("WeatherForecastCaches", Assert.IsType<DropTableOperation>(operation).Name));
    }

    [Fact]
    public void Snapshot_MatchesCurrentModelWithoutDatabaseAccess()
    {
        using var context = CreateModelOnlyContext();
        Assert.False(context.Database.HasPendingModelChanges());
    }

    private static KoochDbContext CreateModelOnlyContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlServer("Server=unused;Database=ModelOnly;Integrated Security=True;TrustServerCertificate=True")
        .Options);
}
