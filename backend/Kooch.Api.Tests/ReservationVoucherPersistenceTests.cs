using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationVoucherPersistenceTests
{
    [Fact]
    public void Voucher_HasImmutableDocumentShapeAndUniqueIdentifiers()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(ReservationVoucher));
        Assert.NotNull(entityType);

        AssertUniqueIndex(entityType, nameof(ReservationVoucher.ReservationId));
        AssertUniqueIndex(entityType, nameof(ReservationVoucher.VoucherNumber));
        Assert.Equal(64, entityType.FindProperty(nameof(ReservationVoucher.VoucherNumber))?.GetMaxLength());

        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.ReservationNumberSnapshot), 32, false);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.PropertyNameSnapshot), 200, false);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.GuestNameSnapshot), 201, false);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.GuestMobileSnapshot), 30, true);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.GuestEmailSnapshot), 320, true);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.RoomTypeNameSnapshot), 150, false);
        AssertSnapshotProperty(entityType, nameof(ReservationVoucher.RoomNameSnapshot), 100, true);

        Assert.NotNull(entityType.FindProperty(nameof(ReservationVoucher.CheckInSnapshot)));
        Assert.NotNull(entityType.FindProperty(nameof(ReservationVoucher.CheckOutSnapshot)));
        Assert.NotNull(entityType.FindProperty(nameof(ReservationVoucher.NightsSnapshot)));
        Assert.NotNull(entityType.FindProperty(nameof(ReservationVoucher.AdultCountSnapshot)));
        Assert.NotNull(entityType.FindProperty(nameof(ReservationVoucher.ChildCountSnapshot)));

        AssertPrecision(entityType, nameof(ReservationVoucher.GrossAmount), 18, 2);
        AssertPrecision(entityType, nameof(ReservationVoucher.CommissionRate), 5, 2);
        AssertPrecision(entityType, nameof(ReservationVoucher.CommissionAmount), 18, 2);
        AssertPrecision(entityType, nameof(ReservationVoucher.PropertyPayableAmount), 18, 2);
        Assert.Equal(3, entityType.FindProperty(nameof(ReservationVoucher.Currency))?.GetMaxLength());
    }

    [Fact]
    public void Voucher_ReservationAndVoucherNumberUniquenessAreEnforced()
    {
        using var database = new VoucherConstraintDatabase();
        database.InsertVoucher(reservationId: 10, voucherNumber: "VOUCHER-A");

        Assert.Throws<SqliteException>(() =>
            database.InsertVoucher(reservationId: 10, voucherNumber: "VOUCHER-B"));
        Assert.Throws<SqliteException>(() =>
            database.InsertVoucher(reservationId: 20, voucherNumber: "VOUCHER-A"));

        database.InsertVoucher(reservationId: 20, voucherNumber: "VOUCHER-B");
        Assert.Equal(2, database.Context.ReservationVouchers.IgnoreQueryFilters().Count());
    }

    [Fact]
    public void Voucher_HistoricalSourceRelationshipsAreRequiredAndNonCascading()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(ReservationVoucher));
        Assert.NotNull(entityType);

        AssertForeignKey(entityType, nameof(ReservationVoucher.ReservationId), typeof(Reservation));
        AssertForeignKey(
            entityType,
            nameof(ReservationVoucher.ReservationFinancialSnapshotId),
            typeof(ReservationFinancialSnapshot));
        AssertForeignKey(entityType, nameof(ReservationVoucher.PropertyId), typeof(Property));
    }

    [Fact]
    public async Task Voucher_CannotBeModifiedThroughTheDbContext()
    {
        await using var context = CreateInMemoryContext();
        var voucher = new ReservationVoucher { Id = 1 };
        context.Attach(voucher);
        context.Entry(voucher).State = EntityState.Modified;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
        Assert.Contains("append-only", error.Message);
    }

    [Fact]
    public void Voucher_CannotBeDeletedThroughTheDbContext()
    {
        using var context = CreateInMemoryContext();
        var voucher = new ReservationVoucher { Id = 1 };
        context.Attach(voucher);
        context.Entry(voucher).State = EntityState.Deleted;

        var error = Assert.Throws<InvalidOperationException>(() => context.SaveChanges());
        Assert.Contains("append-only", error.Message);
    }

    [Fact]
    public async Task Voucher_CannotBeSoftDeletedThroughTheDbContext()
    {
        await using var context = CreateInMemoryContext();
        var voucher = new ReservationVoucher { Id = 1 };
        context.Attach(voucher);
        voucher.IsDeleted = true;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
        Assert.Contains("append-only", error.Message);
    }

    private static void AssertUniqueIndex(IReadOnlyEntityType entityType, string propertyName)
    {
        var index = Assert.Single(
            entityType.GetIndexes(),
            candidate => candidate.Properties.Select(property => property.Name)
                .SequenceEqual([propertyName]));
        Assert.True(index.IsUnique);
    }

    private static void AssertSnapshotProperty(
        IReadOnlyEntityType entityType,
        string propertyName,
        int maxLength,
        bool nullable)
    {
        var property = entityType.FindProperty(propertyName);
        Assert.NotNull(property);
        Assert.Equal(maxLength, property.GetMaxLength());
        Assert.Equal(nullable, property.IsNullable);
    }

    private static void AssertPrecision(
        IReadOnlyEntityType entityType,
        string propertyName,
        int precision,
        int scale)
    {
        var property = entityType.FindProperty(propertyName);
        Assert.NotNull(property);
        Assert.Equal(precision, property.GetPrecision());
        Assert.Equal(scale, property.GetScale());
    }

    private static void AssertForeignKey(
        IReadOnlyEntityType entityType,
        string propertyName,
        Type principalType)
    {
        var foreignKey = Assert.Single(
            entityType.GetForeignKeys(),
            candidate => candidate.Properties.Select(property => property.Name)
                .SequenceEqual([propertyName]));
        Assert.Equal(principalType, foreignKey.PrincipalEntityType.ClrType);
        Assert.True(foreignKey.IsRequired);
        Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior);
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
    }

    private static KoochDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new KoochDbContext(options);
    }

    private sealed class VoucherConstraintDatabase : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public VoucherConstraintDatabase()
        {
            connection.Open();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            Context = new KoochDbContext(options);
            Context.Database.EnsureCreated();
            Context.Database.ExecuteSqlRaw("PRAGMA foreign_keys = OFF;");
        }

        public KoochDbContext Context { get; }

        public void InsertVoucher(int reservationId, string voucherNumber)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ReservationVouchers (
                    ReservationId,
                    ReservationFinancialSnapshotId,
                    PropertyId,
                    VoucherNumber,
                    IssuedAtUtc,
                    ReservationNumberSnapshot,
                    PropertyNameSnapshot,
                    GuestNameSnapshot,
                    RoomTypeNameSnapshot,
                    CheckInSnapshot,
                    CheckOutSnapshot,
                    NightsSnapshot,
                    AdultCountSnapshot,
                    ChildCountSnapshot,
                    GrossAmount,
                    Currency,
                    CommissionRate,
                    CommissionAmount,
                    PropertyPayableAmount,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {reservationId},
                    {reservationId},
                    {1},
                    {voucherNumber},
                    {DateTime.UtcNow},
                    {$"KCH-{reservationId}"},
                    {"Property"},
                    {"Guest"},
                    {"Room Type"},
                    {new DateOnly(2026, 9, 25)},
                    {new DateOnly(2026, 9, 27)},
                    {2},
                    {2},
                    {1},
                    {100m},
                    {"IRR"},
                    {10m},
                    {10m},
                    {90m},
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
