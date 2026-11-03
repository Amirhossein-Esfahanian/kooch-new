using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionCommissionAttributionSchemaTests
{
    private const string ConstraintName = "CK_BookingSessions_CommissionType";
    private const string ConstraintSql = "[CommissionType] IS NULL OR [CommissionType] IN (0, 1, 2)";

    [Fact]
    public void UnassignedSession_RemainsNullWithoutChangingReservationDefault()
    {
        Assert.Null(new BookingSession().CommissionType);
        Assert.Equal(CommissionType.Direct, new Reservation().CommissionType);
    }

    [Theory]
    [InlineData(CommissionType.Direct, 0)]
    [InlineData(CommissionType.PropertyReferralLink, 1)]
    [InlineData(CommissionType.PropertyReferralCode, 2)]
    public void SupportedValues_PreserveTheirNumericSqlMapping(CommissionType value, int expected)
    {
        using var context = CreateModelOnlyContext();
        var property = Model(context).FindEntityType(typeof(BookingSession))!
            .FindProperty(nameof(BookingSession.CommissionType))!;
        var session = new BookingSession { CommissionType = value };

        Assert.Equal(expected, (int)session.CommissionType.Value);
        Assert.Equal(expected, property.GetRelationalTypeMapping().Converter!.ConvertToProvider(value));
    }

    [Fact]
    public void Model_UsesNullableIntWithoutDefaultAndPreservesExistingConstraint()
    {
        using var context = CreateModelOnlyContext();
        var entity = Model(context).FindEntityType(typeof(BookingSession))!;
        var property = entity.FindProperty(nameof(BookingSession.CommissionType))!;

        Assert.Equal(typeof(CommissionType?), property.ClrType);
        Assert.True(property.IsNullable);
        Assert.Equal("int", property.GetColumnType());
        Assert.Null(property.FindAnnotation(RelationalAnnotationNames.DefaultValue));
        Assert.Null(property.GetDefaultValueSql());
        Assert.Null(property.GetComputedColumnSql());
        Assert.Equal(ValueGenerated.Never, property.ValueGenerated);
        Assert.Equal(ConstraintSql, Assert.Single(entity.GetCheckConstraints(), check => check.Name == ConstraintName).Sql);
        Assert.Contains(entity.GetCheckConstraints(), check => check.Name == "CK_BookingSessions_TravelerSnapshot");
        Assert.DoesNotContain(entity.GetIndexes(), index => index.Properties.Contains(property));
    }

    [Fact]
    public void ReservationAndFinancialSnapshot_KeepTheirRequiredCommissionMappings()
    {
        using var context = CreateModelOnlyContext();
        var reservation = Model(context).FindEntityType(typeof(Reservation))!;
        var property = reservation.FindProperty(nameof(Reservation.CommissionType))!;
        Assert.Equal(typeof(CommissionType), property.ClrType);
        Assert.False(property.IsNullable);
        Assert.Equal("int", property.GetColumnType());
        Assert.Equal(CommissionType.Direct, property.GetDefaultValue());

        var snapshot = Model(context).FindEntityType(typeof(ReservationFinancialSnapshot))!;
        Assert.False(snapshot.FindProperty(nameof(ReservationFinancialSnapshot.CommissionType))!.IsNullable);
        Assert.Equal(typeof(CommissionType), snapshot.FindProperty(nameof(ReservationFinancialSnapshot.CommissionType))!.ClrType);
    }

    [Fact]
    public void Migration_OnlyAddsNullableColumnAndCheck_AndDownOnlyRemovesThem()
    {
        var migration = new AddBookingSessionCommissionAttribution();
        AssertApprovedUpOperations(migration.UpOperations);
        Assert.Collection(migration.DownOperations,
            operation =>
            {
                var constraint = Assert.IsType<DropCheckConstraintOperation>(operation);
                Assert.Equal("BookingSessions", constraint.Table);
                Assert.Equal(ConstraintName, constraint.Name);
            },
            operation =>
            {
                var column = Assert.IsType<DropColumnOperation>(operation);
                Assert.Equal("BookingSessions", column.Table);
                Assert.Equal("CommissionType", column.Name);
            });
    }

    [Fact]
    public void GeneratedSql_ContainsNullableColumnAndApprovedCheckWithoutDataChanges()
    {
        using var context = CreateModelOnlyContext();
        var migration = new AddBookingSessionCommissionAttribution();
        var commands = context.GetService<IMigrationsSqlGenerator>().Generate(migration.UpOperations, Model(context));
        var sql = string.Join(Environment.NewLine, commands.Select(command => command.CommandText));
        Assert.Contains("ALTER TABLE [BookingSessions] ADD [CommissionType] int NULL", sql);
        Assert.Contains($"CONSTRAINT [{ConstraintName}] CHECK ({ConstraintSql})", sql);
        Assert.DoesNotContain("UPDATE ", sql);
        Assert.DoesNotContain("DELETE ", sql);
        Assert.DoesNotContain("INSERT ", sql);
    }

    [Fact]
    public void PreviousMigrationToCurrentModel_HasOnlyApprovedChanges_AndSnapshotMatches()
    {
        using var context = CreateModelOnlyContext();
        var previousModel = context.GetService<IModelRuntimeInitializer>().Initialize(
            new LinkRoomPriceHistoryToAuditLog().TargetModel, designTime: true);
        var operations = context.GetService<IMigrationsModelDiffer>().GetDifferences(
            previousModel.GetRelationalModel(), Model(context).GetRelationalModel());

        AssertApprovedUpOperations(operations);
        Assert.False(context.Database.HasPendingModelChanges());
    }

    private static void AssertApprovedUpOperations(IReadOnlyList<MigrationOperation> operations)
    {
        Assert.Collection(operations,
            operation =>
            {
                var column = Assert.IsType<AddColumnOperation>(operation);
                Assert.Equal("BookingSessions", column.Table);
                Assert.Equal("CommissionType", column.Name);
                Assert.Equal("int", column.ColumnType);
                Assert.Equal(typeof(int), column.ClrType);
                Assert.True(column.IsNullable);
                Assert.Null(column.DefaultValue);
                Assert.Null(column.DefaultValueSql);
                Assert.Null(column.ComputedColumnSql);
            },
            operation =>
            {
                var constraint = Assert.IsType<AddCheckConstraintOperation>(operation);
                Assert.Equal("BookingSessions", constraint.Table);
                Assert.Equal(ConstraintName, constraint.Name);
                Assert.Equal(ConstraintSql, constraint.Sql);
            });
    }

    private static IModel Model(KoochDbContext context) => context.GetService<IDesignTimeModel>().Model;

    private static KoochDbContext CreateModelOnlyContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlServer("Server=unused;Database=ModelOnly;Integrated Security=True;TrustServerCertificate=True")
        .Options);
}
