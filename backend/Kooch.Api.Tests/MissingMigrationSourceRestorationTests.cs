using Kooch.Api.Data;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class MissingMigrationSourceRestorationTests
{
    private const string RestoredMigrationId = "20260708074233_guestaddedforreservation";
    private const string AddGuestsMigrationId = "20260708090000_AddGuests";
    private const string AddReservationGuestMigrationId = "20260708100000_AddReservationGuest";
    private const string AddReservationNumberMigrationId = "20260708103000_AddReservationNumber";

    [Fact]
    public void RestoredMigration_IsDiscoveredByEf()
    {
        using var dbContext = new KoochDbContextFactory().CreateDbContext([]);
        var migrationsAssembly = dbContext.GetService<IMigrationsAssembly>();

        Assert.Contains(RestoredMigrationId, migrationsAssembly.Migrations.Keys);
        Assert.Equal(
            typeof(guestaddedforreservation),
            migrationsAssembly.Migrations[RestoredMigrationId].AsType());
    }

    [Fact]
    public void RestoredMigration_UpAndDownAreNoOp()
    {
        var migration = new guestaddedforreservation();

        Assert.Empty(migration.UpOperations);
        Assert.Empty(migration.DownOperations);
    }

    [Fact]
    public void RestoredMigration_IsOrderedBeforeGuestReservationMigrations()
    {
        using var dbContext = new KoochDbContextFactory().CreateDbContext([]);
        var migrationsAssembly = dbContext.GetService<IMigrationsAssembly>();
        var migrationIds = migrationsAssembly.Migrations.Keys.Order(StringComparer.Ordinal).ToList();

        var restoredIndex = migrationIds.IndexOf(RestoredMigrationId);

        Assert.True(restoredIndex >= 0);
        Assert.True(restoredIndex < migrationIds.IndexOf(AddGuestsMigrationId));
        Assert.True(restoredIndex < migrationIds.IndexOf(AddReservationGuestMigrationId));
        Assert.True(restoredIndex < migrationIds.IndexOf(AddReservationNumberMigrationId));
    }
}
