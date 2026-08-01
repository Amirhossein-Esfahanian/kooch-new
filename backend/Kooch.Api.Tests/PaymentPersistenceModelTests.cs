using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PaymentPersistenceModelTests
{
    [Fact]
    public void LegacyPayment_RemainsValidAndQueryable()
    {
        using var database = new PaymentConstraintDatabase();

        var paymentId = database.InsertPayment(
            reservationId: 10,
            bookingSessionId: null,
            provider: "legacy",
            transactionReference: "legacy-reference");

        var payment = database.Context.Payments
            .IgnoreQueryFilters()
            .Single(item => item.Id == paymentId);
        Assert.Equal(10, payment.ReservationId);
        Assert.Null(payment.BookingSessionId);
    }

    [Fact]
    public void SessionPayment_IsValidWithoutReservationParent()
    {
        using var database = new PaymentConstraintDatabase();

        var paymentId = database.InsertPayment(
            reservationId: null,
            bookingSessionId: 20,
            provider: "session",
            transactionReference: "session-reference");

        var payment = database.Context.Payments
            .IgnoreQueryFilters()
            .Single(item => item.Id == paymentId);
        Assert.Null(payment.ReservationId);
        Assert.Equal(20, payment.BookingSessionId);
    }

    [Fact]
    public void Payment_WithBothParents_IsRejected()
    {
        using var database = new PaymentConstraintDatabase();

        Assert.Throws<SqliteException>(() => database.InsertPayment(
            reservationId: 10,
            bookingSessionId: 20,
            provider: "provider",
            transactionReference: "both-parents"));
    }

    [Fact]
    public void Payment_WithoutAParent_IsRejected()
    {
        using var database = new PaymentConstraintDatabase();

        Assert.Throws<SqliteException>(() => database.InsertPayment(
            reservationId: null,
            bookingSessionId: null,
            provider: "provider",
            transactionReference: "no-parent"));
    }

    [Fact]
    public void PaymentItem_HasPositiveAllocatedAmountConstraint()
    {
        using var context = CreateMetadataContext();
        var paymentItemType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(PaymentItem));
        Assert.NotNull(paymentItemType);

        var constraint = Assert.Single(
            paymentItemType.GetCheckConstraints(),
            candidate => candidate.Name == "CK_PaymentItem_PositiveAllocatedAmount");
        Assert.Equal("[AllocatedAmount] > 0", constraint.Sql);
    }

    [Fact]
    public void DuplicatePaymentItemForTheSameReservation_IsRejected()
    {
        using var database = new PaymentConstraintDatabase();
        var paymentId = database.InsertPayment(
            reservationId: null,
            bookingSessionId: 20,
            provider: "provider",
            transactionReference: "duplicate-item");
        database.InsertPaymentItem(paymentId, reservationId: 10, allocatedAmount: 50);

        Assert.Throws<SqliteException>(() =>
            database.InsertPaymentItem(paymentId, reservationId: 10, allocatedAmount: 50));
    }

    [Fact]
    public void DuplicateTransactionReferenceForTheSameProvider_IsRejected()
    {
        using var database = new PaymentConstraintDatabase();
        database.InsertPayment(10, null, "provider", "shared-reference");

        Assert.Throws<SqliteException>(() =>
            database.InsertPayment(11, null, "provider", "shared-reference"));
    }

    [Fact]
    public void SameTransactionReferenceForDifferentProviders_IsAllowed()
    {
        using var database = new PaymentConstraintDatabase();

        database.InsertPayment(10, null, "provider-one", "shared-reference");
        database.InsertPayment(11, null, "provider-two", "shared-reference");

        Assert.Equal(2, database.Context.Payments.IgnoreQueryFilters().Count());
    }

    [Fact]
    public void Payment_RowVersionIsConfiguredForOptimisticConcurrency()
    {
        using var context = CreateMetadataContext();
        var paymentType = context.Model.FindEntityType(typeof(Payment));
        Assert.NotNull(paymentType);

        var rowVersion = paymentType.FindProperty(nameof(Payment.RowVersion));
        Assert.NotNull(rowVersion);
        Assert.True(rowVersion.IsConcurrencyToken);
        Assert.Equal(ValueGenerated.OnAddOrUpdate, rowVersion.ValueGenerated);
    }

    [Fact]
    public void PaymentAndPaymentItem_HaveTheRequiredIndexesAndCurrencyShape()
    {
        using var context = CreateMetadataContext();
        var paymentType = context.Model.FindEntityType(typeof(Payment));
        var paymentItemType = context.Model.FindEntityType(typeof(PaymentItem));
        Assert.NotNull(paymentType);
        Assert.NotNull(paymentItemType);

        Assert.Equal(3, paymentType.FindProperty(nameof(Payment.Currency))?.GetMaxLength());
        Assert.Equal(3, paymentItemType.FindProperty(nameof(PaymentItem.Currency))?.GetMaxLength());

        var sessionIndex = Assert.Single(
            paymentType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(Payment.BookingSessionId)]));
        Assert.False(sessionIndex.IsUnique);

        var referenceIndex = Assert.Single(
            paymentType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(Payment.Provider), nameof(Payment.TransactionReference)]));
        Assert.True(referenceIndex.IsUnique);
        Assert.Equal("[TransactionReference] IS NOT NULL", referenceIndex.GetFilter());

        var allocationIndex = Assert.Single(
            paymentItemType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(PaymentItem.PaymentId), nameof(PaymentItem.ReservationId)]));
        Assert.True(allocationIndex.IsUnique);

        var reservationIndex = Assert.Single(
            paymentItemType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(PaymentItem.ReservationId)]));
        Assert.False(reservationIndex.IsUnique);
    }

    [Fact]
    public void PaymentRelationships_AreOptionalAndNonCascading()
    {
        using var context = CreateMetadataContext();
        var paymentType = context.Model.FindEntityType(typeof(Payment));
        var paymentItemType = context.Model.FindEntityType(typeof(PaymentItem));
        Assert.NotNull(paymentType);
        Assert.NotNull(paymentItemType);

        AssertForeignKey(paymentType, nameof(Payment.ReservationId), typeof(Reservation), false);
        AssertForeignKey(paymentType, nameof(Payment.BookingSessionId), typeof(BookingSession), false);
        AssertForeignKey(paymentItemType, nameof(PaymentItem.PaymentId), typeof(Payment), true);
        AssertForeignKey(paymentItemType, nameof(PaymentItem.ReservationId), typeof(Reservation), true);
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

    private sealed class PaymentConstraintDatabase : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public PaymentConstraintDatabase()
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

        public int InsertPayment(
            int? reservationId,
            int? bookingSessionId,
            string provider,
            string transactionReference)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO Payments (
                    ReservationId,
                    BookingSessionId,
                    Amount,
                    Currency,
                    Status,
                    Provider,
                    TransactionReference,
                    RowVersion,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {reservationId},
                    {bookingSessionId},
                    {100m},
                    {"IRR"},
                    {(int)PaymentStatus.Pending},
                    {provider},
                    {transactionReference},
                    {new byte[] { 1 }},
                    {DateTime.UtcNow},
                    {false});
                """);
            return GetLastInsertRowId();
        }

        public void InsertPaymentItem(
            int paymentId,
            int reservationId,
            decimal allocatedAmount)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO PaymentItems (
                    PaymentId,
                    ReservationId,
                    AllocatedAmount,
                    Currency,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {paymentId},
                    {reservationId},
                    {allocatedAmount},
                    {"IRR"},
                    {DateTime.UtcNow},
                    {false});
                """);
        }

        public void Dispose()
        {
            Context.Dispose();
            connection.Dispose();
        }

        private int GetLastInsertRowId()
        {
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT last_insert_rowid();";
            return Convert.ToInt32(command.ExecuteScalar());
        }
    }
}
