using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CommissionPolicyPersistenceTests
{
    [Fact]
    public void PropertyCommissionRate_HasPercentageConstraintAndPrecision()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(PropertyCommissionRate));
        Assert.NotNull(entityType);

        var rate = entityType.FindProperty(nameof(PropertyCommissionRate.Rate));
        Assert.NotNull(rate);
        Assert.Equal(5, rate.GetPrecision());
        Assert.Equal(2, rate.GetScale());
        Assert.True(entityType.FindProperty(nameof(PropertyCommissionRate.IsEnabled))?.GetDefaultValue() as bool?);

        var constraint = Assert.Single(
            entityType.GetCheckConstraints(),
            candidate => candidate.Name == "CK_PropertyCommissionRate_Rate");
        Assert.Equal("[Rate] >= 0 AND [Rate] <= 100", constraint.Sql);
    }

    [Fact]
    public void PropertyCommissionRate_IsUniquePerPropertyAndCommissionType()
    {
        using var database = new CommissionConstraintDatabase();
        database.InsertRate(1, CommissionType.Direct, 10m);

        Assert.Throws<SqliteException>(() =>
            database.InsertRate(1, CommissionType.Direct, 20m));
    }

    [Fact]
    public void PropertyCommissionRate_AllowsDifferentCommissionTypesForTheSameProperty()
    {
        using var database = new CommissionConstraintDatabase();
        database.InsertRate(1, CommissionType.Direct, 10m);
        database.InsertRate(1, CommissionType.PropertyReferralLink, 8m);
        database.InsertRate(1, CommissionType.PropertyReferralCode, 5m);

        Assert.Equal(3, database.Context.PropertyCommissionRates.IgnoreQueryFilters().Count());
    }

    [Fact]
    public void PropertyCommissionRate_RelationshipIsRequiredAndNonCascading()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(PropertyCommissionRate));
        Assert.NotNull(entityType);

        var foreignKey = Assert.Single(
            entityType.GetForeignKeys(),
            candidate => candidate.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(PropertyCommissionRate.PropertyId)]));
        Assert.Equal(typeof(Property), foreignKey.PrincipalEntityType.ClrType);
        Assert.True(foreignKey.IsRequired);
        Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior);
    }

    [Fact]
    public void Snapshot_PersistsRequiredCommissionClassificationAndRateSource()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(ReservationFinancialSnapshot));
        Assert.NotNull(entityType);

        var commissionType = entityType.FindProperty(nameof(ReservationFinancialSnapshot.CommissionType));
        var rateSource = entityType.FindProperty(nameof(ReservationFinancialSnapshot.CommissionRateSource));
        Assert.NotNull(commissionType);
        Assert.NotNull(rateSource);
        Assert.False(commissionType.IsNullable);
        Assert.False(rateSource.IsNullable);
        Assert.Equal(typeof(CommissionType), commissionType.ClrType);
        Assert.Equal(typeof(CommissionRateSource), rateSource.ClrType);
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
    }

    private sealed class CommissionConstraintDatabase : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public CommissionConstraintDatabase()
        {
            connection.Open();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            Context = new KoochDbContext(options);
            Context.Database.EnsureCreated();
            Context.Database.ExecuteSqlRaw("PRAGMA foreign_keys = OFF;");
            Context.Database.ExecuteSqlRaw("PRAGMA ignore_check_constraints = ON;");
        }

        public KoochDbContext Context { get; }

        public void InsertRate(int propertyId, CommissionType commissionType, decimal rate)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO PropertyCommissionRates (
                    PropertyId,
                    CommissionType,
                    Rate,
                    IsEnabled,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {propertyId},
                    {(int)commissionType},
                    {rate},
                    {true},
                    {DateTime.UtcNow},
                    {false});
                """);
        }

        public void Dispose()
        {
            Context.Dispose();
            connection.Dispose();
        }
    }
}
