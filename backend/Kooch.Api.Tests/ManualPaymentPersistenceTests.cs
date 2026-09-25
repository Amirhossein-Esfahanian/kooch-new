using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ManualPaymentPersistenceTests
{
    [Fact]
    public void PaymentChannelAndManualEnums_HaveStablePersistedValues()
    {
        Assert.Equal(0, (int)PaymentChannel.Online);
        Assert.Equal(1, (int)PaymentChannel.Manual);
        Assert.Equal(0, (int)ManualPaymentMethod.CardToCard);
        Assert.Equal(1, (int)ManualPaymentMethod.BankTransfer);
        Assert.Equal(2, (int)ManualPaymentMethod.Paya);
        Assert.Equal(3, (int)ManualPaymentMethod.Satna);
        Assert.Equal(4, (int)ManualPaymentMethod.AccountTransfer);
        Assert.Equal(5, (int)ManualPaymentMethod.Other);
        Assert.Equal(0, (int)ManualPaymentVerificationStatus.PendingVerification);
        Assert.Equal(1, (int)ManualPaymentVerificationStatus.Approved);
        Assert.Equal(2, (int)ManualPaymentVerificationStatus.Rejected);
    }

    [Fact]
    public void ExistingStylePayment_DefaultsToOnline()
    {
        using var database = new ManualPaymentDatabase();

        var paymentId = database.InsertPaymentWithoutChannel();

        var payment = database.Context.Payments
            .IgnoreQueryFilters()
            .Single(candidate => candidate.Id == paymentId);
        Assert.Equal(PaymentChannel.Online, payment.Channel);
        Assert.Null(payment.ManualDetails);
    }

    [Fact]
    public void ManualPayment_PersistsDetailsWithoutDuplicatingAmountOrCurrency()
    {
        using var database = new ManualPaymentDatabase();
        var paymentId = database.InsertPayment(PaymentChannel.Manual);
        database.Context.ManualPaymentDetails.Add(new ManualPaymentDetails
        {
            PaymentId = paymentId,
            Method = ManualPaymentMethod.CardToCard,
            VerificationStatus = ManualPaymentVerificationStatus.PendingVerification,
            PaymentDate = new DateOnly(2026, 9, 25),
            PaymentTime = new TimeOnly(10, 30),
            ReferenceNumber = "REF-100",
            DestinationBank = "Kooch Bank",
            DestinationAccountReference = "ACCOUNT-1",
            Notes = "Submitted payment evidence.",
            EvidenceFilePath = "/media/manual-payments/evidence.jpg",
            SubmittedByUserId = 50,
            SubmittedAtUtc = new DateTime(2026, 9, 25, 7, 0, 0, DateTimeKind.Utc)
        });
        database.Context.SaveChanges();
        database.Context.ChangeTracker.Clear();

        var persisted = database.Context.Payments
            .IgnoreQueryFilters()
            .Include(candidate => candidate.ManualDetails)
            .Single(candidate => candidate.Id == paymentId);
        Assert.Equal(PaymentChannel.Manual, persisted.Channel);
        Assert.Equal(100m, persisted.Amount);
        Assert.Equal("IRR", persisted.Currency);
        Assert.NotNull(persisted.ManualDetails);
        Assert.Equal(ManualPaymentMethod.CardToCard, persisted.ManualDetails.Method);
        Assert.Equal(
            ManualPaymentVerificationStatus.PendingVerification,
            persisted.ManualDetails.VerificationStatus);

        var detailsType = database.Context.Model.FindEntityType(typeof(ManualPaymentDetails));
        Assert.NotNull(detailsType);
        Assert.Null(detailsType.FindProperty("Amount"));
        Assert.Null(detailsType.FindProperty("Currency"));
    }

    [Fact]
    public void Payment_CannotHaveDuplicateManualDetails()
    {
        using var database = new ManualPaymentDatabase();
        var paymentId = database.InsertPayment(PaymentChannel.Manual);
        database.InsertManualDetails(paymentId, ManualPaymentVerificationStatus.PendingVerification);

        Assert.Throws<SqliteException>(() =>
            database.InsertManualDetails(paymentId, ManualPaymentVerificationStatus.PendingVerification));
    }

    [Theory]
    [InlineData(ManualPaymentVerificationStatus.PendingVerification)]
    [InlineData(ManualPaymentVerificationStatus.Approved)]
    [InlineData(ManualPaymentVerificationStatus.Rejected)]
    public void ManualVerificationStatus_Persists(ManualPaymentVerificationStatus status)
    {
        using var database = new ManualPaymentDatabase();
        var paymentId = database.InsertPayment(PaymentChannel.Manual);

        database.InsertManualDetails(paymentId, status);

        Assert.Equal(
            status,
            database.Context.ManualPaymentDetails
                .IgnoreQueryFilters()
                .Single(details => details.PaymentId == paymentId)
                .VerificationStatus);
    }

    [Fact]
    public void ManualDetails_HasExpectedShapeIndexesAndSafeRelationships()
    {
        using var context = CreateMetadataContext();
        var designModel = context.GetService<IDesignTimeModel>().Model;
        var detailsType = designModel.FindEntityType(typeof(ManualPaymentDetails));
        var paymentType = designModel.FindEntityType(typeof(Payment));
        Assert.NotNull(detailsType);
        Assert.NotNull(paymentType);

        Assert.Equal(PaymentChannel.Online, paymentType.FindProperty(nameof(Payment.Channel))?.GetDefaultValue());
        Assert.Equal(
            ManualPaymentVerificationStatus.PendingVerification,
            detailsType.FindProperty(nameof(ManualPaymentDetails.VerificationStatus))?.GetDefaultValue());
        Assert.Equal(200, detailsType.FindProperty(nameof(ManualPaymentDetails.ReferenceNumber))?.GetMaxLength());
        Assert.Equal(100, detailsType.FindProperty(nameof(ManualPaymentDetails.DestinationBank))?.GetMaxLength());
        Assert.Equal(
            200,
            detailsType.FindProperty(nameof(ManualPaymentDetails.DestinationAccountReference))?.GetMaxLength());
        Assert.Equal(2000, detailsType.FindProperty(nameof(ManualPaymentDetails.Notes))?.GetMaxLength());
        Assert.Equal(2048, detailsType.FindProperty(nameof(ManualPaymentDetails.EvidenceFilePath))?.GetMaxLength());
        Assert.Equal(1000, detailsType.FindProperty(nameof(ManualPaymentDetails.RejectionReason))?.GetMaxLength());

        var paymentIndex = Assert.Single(
            detailsType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(ManualPaymentDetails.PaymentId)]));
        Assert.True(paymentIndex.IsUnique);

        AssertForeignKey(detailsType, nameof(ManualPaymentDetails.PaymentId), typeof(Payment), true);
        AssertForeignKey(detailsType, nameof(ManualPaymentDetails.SubmittedByUserId), typeof(User), false);
        AssertForeignKey(detailsType, nameof(ManualPaymentDetails.VerifiedByUserId), typeof(User), false);
        AssertForeignKey(detailsType, nameof(ManualPaymentDetails.RejectedByUserId), typeof(User), false);
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

    private sealed class ManualPaymentDatabase : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");

        public ManualPaymentDatabase()
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

        public int InsertPaymentWithoutChannel()
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO Payments (
                    ReservationId,
                    Amount,
                    Currency,
                    Status,
                    RowVersion,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {10},
                    {100m},
                    {"IRR"},
                    {(int)PaymentStatus.Pending},
                    {new byte[] { 1 }},
                    {DateTime.UtcNow},
                    {false});
                """);
            return GetLastInsertRowId();
        }

        public int InsertPayment(PaymentChannel channel)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO Payments (
                    ReservationId,
                    Channel,
                    Amount,
                    Currency,
                    Status,
                    RowVersion,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {10},
                    {(int)channel},
                    {100m},
                    {"IRR"},
                    {(int)PaymentStatus.Pending},
                    {new byte[] { 1 }},
                    {DateTime.UtcNow},
                    {false});
                """);
            return GetLastInsertRowId();
        }

        public void InsertManualDetails(
            int paymentId,
            ManualPaymentVerificationStatus verificationStatus)
        {
            Context.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ManualPaymentDetails (
                    PaymentId,
                    Method,
                    VerificationStatus,
                    PaymentDate,
                    SubmittedAtUtc,
                    CreatedAtUtc,
                    IsDeleted)
                VALUES (
                    {paymentId},
                    {(int)ManualPaymentMethod.BankTransfer},
                    {(int)verificationStatus},
                    {new DateOnly(2026, 9, 25)},
                    {DateTime.UtcNow},
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
