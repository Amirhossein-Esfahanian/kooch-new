using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RoomDailyPriceHistoryPropertyIdMigrationTests
{
    [Fact]
    public void Migration_UsesRoomTypePropertyIdAsCanonicalValue()
    {
        var migration = new FixRoomDailyPriceHistoryPropertyIds();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("INNER JOIN RoomTypes AS roomType ON roomType.Id = history.RoomTypeId", sql);
        Assert.Contains("SET PropertyId = roomType.PropertyId", sql);
        Assert.Contains("WHERE history.PropertyId <> roomType.PropertyId", sql);
        Assert.Contains("PRINT CONCAT('RoomDailyPriceHistory property id corrections:", sql);
        Assert.Contains("PRINT CONCAT('RoomDailyPriceHistory property id correction affected rows:", sql);
    }

    [Fact]
    public void Migration_HasPreconditionsForCanonicalRoomTypeAndProperty()
    {
        var migration = new FixRoomDailyPriceHistoryPropertyIds();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("THROW 51020", sql);
        Assert.Contains("missing or deleted RoomType", sql);
        Assert.Contains("roomType.IsDeleted = 0", sql);
        Assert.Contains("THROW 51021", sql);
        Assert.Contains("missing or deleted Property", sql);
        Assert.Contains("property.IsDeleted = 0", sql);
    }

    [Fact]
    public void Migration_DoesNotChangePriceDateActorOrRoomFields()
    {
        var migration = new FixRoomDailyPriceHistoryPropertyIds();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.DoesNotContain("SET RoomTypeId", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET OldBasePrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET NewBasePrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET OldChildPrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET NewChildPrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET OldExtraGuestPrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET NewExtraGuestPrice", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET AffectedDateFrom", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET AffectedDateTo", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET GuestType", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET ChangedByUserId", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET ChangedAtUtc", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET CreatedAtUtc", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET UpdatedAtUtc", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void KnownMismatchedRows_MapToCanonicalPropertyTwo()
    {
        var historyRows = new[]
        {
            new HistoryRow(1, 3, 1),
            new HistoryRow(2, 3, 1),
            new HistoryRow(3, 3, 1),
            new HistoryRow(4, 3, 1)
        };
        var roomTypes = new[]
        {
            new RoomTypeRow(3, 2, IsDeleted: false)
        };
        var properties = new[]
        {
            new PropertyRow(2, IsDeleted: false)
        };

        var corrections = FindCorrections(historyRows, roomTypes, properties);

        Assert.Equal(
            [
                new Correction(1, 3, 1, 2),
                new Correction(2, 3, 1, 2),
                new Correction(3, 3, 1, 2),
                new Correction(4, 3, 1, 2)
            ],
            corrections);
    }

    [Fact]
    public void CleanState_ProducesNoCorrections()
    {
        var historyRows = new[]
        {
            new HistoryRow(10, 3, 2),
            new HistoryRow(11, 4, 5)
        };
        var roomTypes = new[]
        {
            new RoomTypeRow(3, 2, IsDeleted: false),
            new RoomTypeRow(4, 5, IsDeleted: false)
        };
        var properties = new[]
        {
            new PropertyRow(2, IsDeleted: false),
            new PropertyRow(5, IsDeleted: false)
        };

        var corrections = FindCorrections(historyRows, roomTypes, properties);

        Assert.Empty(corrections);
    }

    [Fact]
    public void DownMigration_IsClearlyIrreversible()
    {
        var migration = new FixRoomDailyPriceHistoryPropertyIds();
        var sql = Assert.Single(migration.DownOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("THROW 51022", sql);
        Assert.Contains("irreversible data correction", sql);
    }

    private static IReadOnlyList<Correction> FindCorrections(
        IReadOnlyCollection<HistoryRow> historyRows,
        IReadOnlyCollection<RoomTypeRow> roomTypes,
        IReadOnlyCollection<PropertyRow> properties)
    {
        var activeRoomTypes = roomTypes.Where(roomType => !roomType.IsDeleted)
            .ToDictionary(roomType => roomType.Id);
        var activePropertyIds = properties.Where(property => !property.IsDeleted)
            .Select(property => property.Id)
            .ToHashSet();

        if (historyRows.Any(history => !activeRoomTypes.ContainsKey(history.RoomTypeId)))
        {
            throw new InvalidOperationException("Missing or deleted RoomType.");
        }

        var corrections = historyRows.Select(history =>
            {
                var roomType = activeRoomTypes[history.RoomTypeId];
                return new Correction(history.Id, history.RoomTypeId, history.PropertyId, roomType.PropertyId);
            })
            .Where(correction => correction.OldPropertyId != correction.NewPropertyId)
            .ToList();

        if (corrections.Any(correction => !activePropertyIds.Contains(correction.NewPropertyId)))
        {
            throw new InvalidOperationException("Missing or deleted canonical Property.");
        }

        return corrections;
    }

    private sealed record HistoryRow(int Id, int RoomTypeId, int PropertyId);
    private sealed record RoomTypeRow(int Id, int PropertyId, bool IsDeleted);
    private sealed record PropertyRow(int Id, bool IsDeleted);
    private sealed record Correction(int HistoryId, int RoomTypeId, int OldPropertyId, int NewPropertyId);
}
