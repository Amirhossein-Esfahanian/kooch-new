using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class FinancialFoundationPersistenceTests
{
    [Fact]
    public void Snapshot_HasRequiredMonetaryShapeAndUniqueAllocationIndexes()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(ReservationFinancialSnapshot));
        Assert.NotNull(entityType);

        AssertPrecision(entityType, nameof(ReservationFinancialSnapshot.GrossAmount), 18, 2);
        AssertPrecision(entityType, nameof(ReservationFinancialSnapshot.CommissionRate), 5, 2);
        AssertPrecision(entityType, nameof(ReservationFinancialSnapshot.CommissionBase), 18, 2);
        AssertPrecision(entityType, nameof(ReservationFinancialSnapshot.CommissionAmount), 18, 2);
        AssertPrecision(entityType, nameof(ReservationFinancialSnapshot.PropertyPayableAmount), 18, 2);
        Assert.Equal(3, entityType.FindProperty(nameof(ReservationFinancialSnapshot.Currency))?.GetMaxLength());

        var allocationIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([
                    nameof(ReservationFinancialSnapshot.PaymentId),
                    nameof(ReservationFinancialSnapshot.ReservationId)]));
        Assert.True(allocationIndex.IsUnique);

        var paymentItemIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(ReservationFinancialSnapshot.PaymentItemId)]));
        Assert.True(paymentItemIndex.IsUnique);
        Assert.Equal("[PaymentItemId] IS NOT NULL", paymentItemIndex.GetFilter());
    }

    [Fact]
    public void Snapshot_DuplicatePaymentReservationOrPaymentItem_IsRejected()
    {
        using var database = new FinancialConstraintDatabase();
        database.InsertSnapshot(paymentId: 1, reservationId: 10, paymentItemId: null);

        Assert.Throws<SqliteException>(() =>
            database.InsertSnapshot(paymentId: 1, reservationId: 10, paymentItemId: null));

        database.InsertSnapshot(paymentId: 2, reservationId: 20, paymentItemId: 100);
        Assert.Throws<SqliteException>(() =>
            database.InsertSnapshot(paymentId: 3, reservationId: 30, paymentItemId: 100));
    }

    [Fact]
    public void FinancialEntry_HasCurrencyShapeAndPerTypeCorrelationUniqueness()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(FinancialEntry));
        Assert.NotNull(entityType);

        AssertPrecision(entityType, nameof(FinancialEntry.Amount), 18, 2);
        Assert.Equal(3, entityType.FindProperty(nameof(FinancialEntry.Currency))?.GetMaxLength());
        Assert.Equal(200, entityType.FindProperty(nameof(FinancialEntry.CorrelationKey))?.GetMaxLength());
        Assert.Equal(1000, entityType.FindProperty(nameof(FinancialEntry.Reason))?.GetMaxLength());

        var correlationIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(FinancialEntry.EntryType), nameof(FinancialEntry.CorrelationKey)]));
        Assert.True(correlationIndex.IsUnique);
    }

    [Fact]
    public void FinancialEntry_DuplicateCorrelationForTheSameType_IsRejected()
    {
        using var database = new FinancialConstraintDatabase();
        database.InsertEntry(FinancialEntryType.PropertyPayable, "payment:1:reservation:10");

        Assert.Throws<SqliteException>(() =>
            database.InsertEntry(FinancialEntryType.PropertyPayable, "payment:1:reservation:10"));

        database.InsertEntry(FinancialEntryType.Commission, "payment:1:reservation:10");
        Assert.Equal(2, database.Context.FinancialEntries.IgnoreQueryFilters().Count());
    }

    [Fact]
    public void FinancialFoundation_RelationshipsAreNonCascading()
    {
        using var context = CreateMetadataContext();
        var model = context.GetService<IDesignTimeModel>().Model;
        var snapshotType = model.FindEntityType(typeof(ReservationFinancialSnapshot));
        var entryType = model.FindEntityType(typeof(FinancialEntry));
        Assert.NotNull(snapshotType);
        Assert.NotNull(entryType);

        AssertForeignKey(snapshotType, nameof(ReservationFinancialSnapshot.ReservationId), typeof(Reservation), true);
        AssertForeignKey(snapshotType, nameof(ReservationFinancialSnapshot.PropertyId), typeof(Property), true);
        AssertForeignKey(snapshotType, nameof(ReservationFinancialSnapshot.PaymentId), typeof(Payment), true);
        AssertForeignKey(snapshotType, nameof(ReservationFinancialSnapshot.PaymentItemId), typeof(PaymentItem), false);

        AssertForeignKey(entryType, nameof(FinancialEntry.PropertyId), typeof(Property), true);
        AssertForeignKey(entryType, nameof(FinancialEntry.ReservationId), typeof(Reservation), false);
        AssertForeignKey(entryType, nameof(FinancialEntry.PaymentId), typeof(Payment), false);
        AssertForeignKey(entryType, nameof(FinancialEntry.PaymentItemId), typeof(PaymentItem), false);
        AssertForeignKey(entryType, nameof(FinancialEntry.ReversesEntryId), typeof(FinancialEntry), false);
    }

    [Fact]
    public async Task Snapshot_CannotBeModifiedThroughTheDbContext()
    {
        await using var context = CreateInMemoryContext();
        var snapshot = new ReservationFinancialSnapshot { Id = 1 };
        context.Attach(snapshot);
        context.Entry(snapshot).State = EntityState.Modified;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
        Assert.Contains("append-only", error.Message);
    }

    [Fact]
    public void FinancialEntry_CannotBeDeletedThroughTheDbContext()
    {
        using var context = CreateInMemoryContext();
        var entry = new FinancialEntry { Id = 1 };
        context.Attach(entry);
        context.Entry(entry).State = EntityState.Deleted;

        var error = Assert.Throws<InvalidOperationException>(() => context.SaveChanges());
        Assert.Contains("append-only", error.Message);
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
        Type principalType,
        bool isRequired)
    {
        var foreignKey = Assert.Single(
            entityType.GetForeignKeys(),
            candidate => candidate.Properties.Select(property => property.Name)
                .SequenceEqual([propertyName]));
        Assert.Equal(principalType, foreignKey.PrincipalEntityType.ClrType);
        Assert.Equal(isRequired, foreignKey.IsRequired);
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

    private sealed class FinancialConstraintDatabase : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public FinancialConstraintDatabase()
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

        public void InsertSnapshot(int paymentId, int reservationId, int? paymentItemId)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ReservationFinancialSnapshots (
                    ReservationId,
                    PropertyId,
                    PaymentId,
                    PaymentItemId,
                    GrossAmount,
                    Currency,
                    CommissionType,
                    CommissionRateSource,
                    CommissionRate,
                    CommissionBase,
                    CommissionAmount,
                    PropertyPayableAmount,
                    CalculatedAtUtc,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {reservationId},
                    {1},
                    {paymentId},
                    {paymentItemId},
                    {100m},
                    {"IRR"},
                    {(int)CommissionType.Direct},
                    {(int)CommissionRateSource.Global},
                    {10m},
                    {100m},
                    {10m},
                    {90m},
                    {DateTime.UtcNow},
                    {DateTime.UtcNow},
                    {false});
                """);
        }

        public void InsertEntry(FinancialEntryType entryType, string correlationKey)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO FinancialEntries (
                    PropertyId,
                    EntryType,
                    Amount,
                    Currency,
                    EffectiveAtUtc,
                    CorrelationKey,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {1},
                    {(int)entryType},
                    {100m},
                    {"IRR"},
                    {DateTime.UtcNow},
                    {correlationKey},
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
