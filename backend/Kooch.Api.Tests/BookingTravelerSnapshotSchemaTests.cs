using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingTravelerSnapshotSchemaTests
{
    [Fact]
    public void Migration_IsAdditiveAndDownRemovesOnlyItsOwnSchema()
    {
        var migration = new AddBookingTravelerSnapshots();
        Assert.Equal(16, migration.UpOperations.Count);
        var columns = migration.UpOperations.OfType<AddColumnOperation>().ToArray();
        Assert.Equal(14, columns.Length);
        Assert.Equal(2, migration.UpOperations.OfType<AddCheckConstraintOperation>().Count());
        foreach (var table in new[] { "BookingSessions", "Reservations" })
        {
            Assert.Equal(7, columns.Count(column => column.Table == table));
            Assert.All(columns.Where(column => column.Table == table), column =>
            {
                Assert.True(column.IsNullable);
                Assert.Null(column.DefaultValue);
                Assert.Null(column.DefaultValueSql);
                Assert.Equal(Types[column.Name], column.ColumnType);
            });
        }
        Assert.Equal(16, migration.DownOperations.Count);
        Assert.All(migration.DownOperations.Take(2), operation => Assert.IsType<DropCheckConstraintOperation>(operation));
        Assert.Equal(14, migration.DownOperations.OfType<DropColumnOperation>().Count());
    }

    [Theory]
    [InlineData(typeof(BookingSession))]
    [InlineData(typeof(Reservation))]
    public void Model_UsesNullableApprovedTypesAndSnapshotShapeConstraint(Type entityType)
    {
        using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=ModelOnly;Trusted_Connection=True;TrustServerCertificate=True")
            .Options);
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(entityType)!;
        foreach (var (name, sqlType) in Types)
        {
            var property = entity.FindProperty(name)!;
            Assert.True(property.IsNullable);
            Assert.Equal(sqlType, property.GetColumnType());
        }
        var constraint = Assert.Single(entity.GetCheckConstraints(),
            item => item.Name == $"CK_{entity.GetTableName()}_TravelerSnapshot");
        Assert.Contains("[TravelerSnapshotKind] IS NOT NULL", constraint.Sql);
        Assert.Contains("[TravelerSnapshotKind] IN (1, 2)", constraint.Sql);
        Assert.Contains("[TravelerSnapshotCapturedAtUtc] IS NOT NULL", constraint.Sql);
        Assert.Contains("LEN(LTRIM(RTRIM([TravelerFirstNameSnapshot]))) > 0", constraint.Sql);
        Assert.Contains("LEN(LTRIM(RTRIM([TravelerLastNameSnapshot]))) > 0", constraint.Sql);
        foreach (var name in Types.Keys)
            Assert.Contains($"[{name}] IS NULL", constraint.Sql);
    }

    private static readonly Dictionary<string, string> Types = new()
    {
        ["TravelerSnapshotKind"] = "tinyint",
        ["TravelerFirstNameSnapshot"] = "nvarchar(100)",
        ["TravelerLastNameSnapshot"] = "nvarchar(100)",
        ["TravelerMobileSnapshot"] = "nvarchar(30)",
        ["TravelerEmailSnapshot"] = "nvarchar(320)",
        ["TravelerNationalCodeSnapshot"] = "nvarchar(20)",
        ["TravelerSnapshotCapturedAtUtc"] = "datetime2(7)"
    };
}
