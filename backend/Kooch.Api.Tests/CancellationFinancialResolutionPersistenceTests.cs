using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CancellationFinancialResolutionPersistenceTests
{
    [Fact]
    public void Migration_IsAdditiveAndDoesNotBackfillHistoricalRefunds()
    {
        var operations = new AddCancellationFinancialResolution().UpOperations;
        var table = Assert.Single(operations.OfType<CreateTableOperation>());
        Assert.Equal("CancellationFinancialResolutions", table.Name);
        Assert.Equal(2, table.CheckConstraints.Count);
        Assert.All(table.ForeignKeys, fk => Assert.Equal(ReferentialAction.NoAction, fk.OnDelete));
        var column = Assert.Single(operations.OfType<AddColumnOperation>());
        Assert.Equal("RefundRecords", column.Table);
        Assert.Equal("CancellationFinancialResolutionId", column.Name);
        Assert.True(column.IsNullable);
        Assert.Null(column.DefaultValue);
        Assert.Null(column.DefaultValueSql);
        Assert.All(operations, operation => Assert.True(operation is
            CreateTableOperation or AddColumnOperation or CreateIndexOperation or AddForeignKeyOperation));
        var refundIndex = Assert.Single(operations.OfType<CreateIndexOperation>(), i => i.Table == "RefundRecords");
        Assert.True(refundIndex.IsUnique);
        Assert.Equal("[CancellationFinancialResolutionId] IS NOT NULL", refundIndex.Filter);
    }

    [Theory]
    [InlineData(CancellationFinancialResolutionMode.AutomaticFullRefundV1, 100, 0, 0)]
    [InlineData(CancellationFinancialResolutionMode.ManualOverride, 50, 40, 10)]
    [InlineData(CancellationFinancialResolutionMode.ManualOverride, 0, 80, 20)]
    public async Task ValidAllocation_PersistsWithoutPostingOrRefundExecution(
        CancellationFinancialResolutionMode mode, decimal guest, decimal property, decimal kooch)
    {
        using var database = new Database();
        var resolution = Resolution();
        resolution.Mode = mode;
        resolution.GuestRefundAmount = guest;
        resolution.FinalPropertyShare = property;
        resolution.FinalKoochShare = kooch;
        database.Context.Add(resolution);
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();

        var saved = await database.Context.CancellationFinancialResolutions.SingleAsync();
        Assert.Equal(mode, saved.Mode);
        Assert.Equal(100m, saved.GrossPaidAmount);
        Assert.Equal(guest, saved.GuestRefundAmount);
        Assert.Equal(property, saved.FinalPropertyShare);
        Assert.Equal(kooch, saved.FinalKoochShare);
        Assert.Equal("IRR", saved.Currency);
        Assert.Equal(1, saved.ReservationFinancialSnapshotId);
        Assert.Equal(1, saved.OriginalPropertyPayableEntryId);
        Assert.Null(saved.ReversalFinancialEntryId);
        Assert.Null(saved.ReplacementPropertyPayableEntryId);
        Assert.Null(saved.ReleasedSettlementId);
        Assert.Empty(await database.Context.RefundRecords.ToListAsync());
        Assert.Empty(await database.Context.FinancialEntries.ToListAsync());
    }

    [Theory]
    [InlineData(-1, -1, 0, 0)]
    [InlineData(100, -1, 101, 0)]
    [InlineData(100, 101, -1, 0)]
    [InlineData(100, 101, 0, -1)]
    [InlineData(100, 50, 40, 9)]
    public async Task InvalidAmounts_RejectedByPersistenceAndDatabaseIndependently(
        decimal gross, decimal guest, decimal property, decimal kooch)
    {
        using var database = new Database();
        var resolution = Resolution();
        resolution.GrossPaidAmount = gross;
        resolution.GuestRefundAmount = guest;
        resolution.FinalPropertyShare = property;
        resolution.FinalKoochShare = kooch;
        database.Context.Add(resolution);
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
        database.Context.ChangeTracker.Clear();

        // Bypass the EF guard to verify constraints in the schema generated from the production model.
        Assert.Throws<SqliteException>(() => database.Context.Database.ExecuteSqlInterpolated($"""
            INSERT INTO CancellationFinancialResolutions (
                ReservationId, PaymentId, PropertyId, ReservationFinancialSnapshotId, OriginalPropertyPayableEntryId,
                GrossPaidAmount, Currency, GuestRefundAmount, FinalPropertyShare, FinalKoochShare,
                Mode, Reason, ResolvedByUserId, ResolvedAtUtc, IdempotencyKey, RequestFingerprint, CreatedAtUtc, IsDeleted)
            VALUES (1, 1, 1, 1, 1, {gross}, 'IRR', {guest}, {property}, {kooch},
                1, 'test', 1, {DateTime.UtcNow}, 'key', 'hash', {DateTime.UtcNow}, 0)
            """));
        Assert.Empty(await database.Context.CancellationFinancialResolutions.ToListAsync());
    }

    [Theory]
    [InlineData("100.001")]
    [InlineData("10000000000000000")]
    public async Task ExcessPrecisionOrStorageOverflow_IsRejectedWithoutRounding(string value)
    {
        using var database = new Database();
        var amount = decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
        var resolution = Resolution();
        resolution.GrossPaidAmount = resolution.GuestRefundAmount = amount;
        database.Context.Add(resolution);
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
        Assert.Equal(amount, resolution.GuestRefundAmount);
        Assert.Empty(await database.Context.CancellationFinancialResolutions.AsNoTracking().ToListAsync());
    }

    [Theory]
    [InlineData("allocation")]
    [InlineData("idempotency")]
    [InlineData("payment-item")]
    [InlineData("original-payable")]
    public async Task DuplicateSourceOrIdempotencyKey_IsRejectedByUniqueIndex(string duplicate)
    {
        using var database = new Database();
        var first = Resolution();
        first.PaymentItemId = 10;
        database.Context.Add(first);
        await database.Context.SaveChangesAsync();
        var second = Resolution(2);
        switch (duplicate)
        {
            case "allocation": second.PaymentId = first.PaymentId; second.ReservationId = first.ReservationId; break;
            case "idempotency": second.IdempotencyKey = first.IdempotencyKey; break;
            case "payment-item": second.PaymentItemId = first.PaymentItemId; break;
            case "original-payable": second.OriginalPropertyPayableEntryId = first.OriginalPropertyPayableEntryId; break;
        }
        database.Context.Add(second);
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => database.Context.SaveChangesAsync());
        Assert.Equal(19, Assert.IsType<SqliteException>(error.InnerException).SqliteErrorCode);
    }

    [Fact]
    public async Task DifferentDirectAndSessionAllocations_AreNotBlockedByOverbroadUniqueness()
    {
        using var database = new Database();
        var direct1 = Resolution(1);
        var direct2 = Resolution(2);
        var session1 = Resolution(3);
        var session2 = Resolution(4);
        session1.PaymentItemId = 30;
        session2.PaymentId = session1.PaymentId;
        session2.PaymentItemId = 40;
        database.Context.AddRange(direct1, direct2, session1, session2);
        await database.Context.SaveChangesAsync();
        Assert.Equal(4, await database.Context.CancellationFinancialResolutions.CountAsync());
    }

    [Fact]
    public async Task RefundLink_IsOptionalForLegacyAndUniqueForResolution()
    {
        using var database = new Database();
        var resolution = Resolution();
        database.Context.Add(resolution);
        await database.Context.SaveChangesAsync();
        var linked = Refund(1);
        linked.CancellationFinancialResolutionId = resolution.Id;
        database.Context.AddRange(linked, Refund(2), Refund(3));
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        Assert.Equal(2, await database.Context.RefundRecords.CountAsync(r => r.CancellationFinancialResolutionId == null));
        Assert.Equal(resolution.Id, (await database.Context.RefundRecords.SingleAsync(r => r.PaymentId == 1)).CancellationFinancialResolutionId);

        // Distinct allocation/key isolates the new unique link from the pre-existing refund indexes.
        var duplicate = Refund(4);
        duplicate.CancellationFinancialResolutionId = resolution.Id;
        database.Context.Add(duplicate);
        await Assert.ThrowsAsync<DbUpdateException>(() => database.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task EverySaveChangesOverload_RejectsResolutionUpdates(int overload)
    {
        using var database = new Database();
        var resolution = Resolution();
        database.Context.Add(resolution);
        await database.Context.SaveChangesAsync();
        resolution.Reason = "Changed history";
        switch (overload)
        {
            case 0: Assert.Throws<InvalidOperationException>(() => database.Context.SaveChanges()); break;
            case 1: Assert.Throws<InvalidOperationException>(() => database.Context.SaveChanges(true)); break;
            case 2: await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync()); break;
            case 3: await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync(true)); break;
        }
    }

    [Theory]
    [InlineData("delete")]
    [InlineData("soft-delete")]
    [InlineData("posting-link")]
    public async Task ResolutionHistory_CannotBeDeletedOrPatchedAfterInsert(string mutation)
    {
        using var database = new Database();
        var resolution = Resolution();
        database.Context.Add(resolution);
        await database.Context.SaveChangesAsync();
        switch (mutation)
        {
            case "delete": database.Context.Remove(resolution); break;
            case "soft-delete": resolution.IsDeleted = true; break;
            case "posting-link": resolution.ReversalFinancialEntryId = 22; break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
    }

    [Fact]
    public async Task PostingLinks_MayBeSuppliedAtInitialInsert_RefundLinkRemainsImmutable()
    {
        using var database = new Database();
        var resolution = Resolution();
        resolution.ReversalFinancialEntryId = 22;
        resolution.ReplacementPropertyPayableEntryId = 23;
        resolution.ReleasedSettlementId = 24;
        database.Context.Add(resolution);
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        var saved = await database.Context.CancellationFinancialResolutions.SingleAsync();
        Assert.Equal(22, saved.ReversalFinancialEntryId);
        Assert.Equal(23, saved.ReplacementPropertyPayableEntryId);
        Assert.Equal(24, saved.ReleasedSettlementId);
        var legacyRefund = Refund(1);
        database.Context.Add(legacyRefund);
        await database.Context.SaveChangesAsync();
        legacyRefund.CancellationFinancialResolutionId = saved.Id;
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
    }

    [Fact]
    public void SqlServerModel_UsesStableEnumMoneyShapeExplicitNonCascadingLinksAndFilteredIndexes()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata_only;Integrated Security=True;TrustServerCertificate=True").Options);
        var model = context.GetService<IDesignTimeModel>().Model;
        var entity = model.FindEntityType(typeof(CancellationFinancialResolution))!;
        Assert.Equal(0, (int)CancellationFinancialResolutionMode.AutomaticFullRefundV1);
        Assert.Equal(1, (int)CancellationFinancialResolutionMode.ManualOverride);
        foreach (var name in new[] { "GrossPaidAmount", "GuestRefundAmount", "FinalPropertyShare", "FinalKoochShare" })
        {
            Assert.Equal(18, entity.FindProperty(name)!.GetPrecision());
            Assert.Equal(2, entity.FindProperty(name)!.GetScale());
        }
        Assert.Equal(3, entity.FindProperty("Currency")!.GetMaxLength());
        var expectedLinks = new (string Name, Type Type, bool Required)[]
        {
            ("ReservationId", typeof(Reservation), true), ("PaymentId", typeof(Payment), false),
            ("PaymentItemId", typeof(PaymentItem), false), ("PropertyId", typeof(Property), true),
            ("ReservationFinancialSnapshotId", typeof(ReservationFinancialSnapshot), true),
            ("OriginalPropertyPayableEntryId", typeof(FinancialEntry), true),
            ("ReversalFinancialEntryId", typeof(FinancialEntry), false),
            ("ReplacementPropertyPayableEntryId", typeof(FinancialEntry), false),
            ("ReleasedSettlementId", typeof(Settlement), false), ("ResolvedByUserId", typeof(User), true)
        };
        Assert.Equal(expectedLinks.Length, entity.GetForeignKeys().Count());
        foreach (var link in expectedLinks)
        {
            var fk = Assert.Single(entity.GetForeignKeys(), f => f.Properties.Single().Name == link.Name);
            Assert.Equal(link.Type, fk.PrincipalEntityType.ClrType);
            Assert.Equal(link.Required, fk.IsRequired);
            Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior);
        }
        var itemIndex = Assert.Single(entity.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(["PaymentItemId"]));
        Assert.True(itemIndex.IsUnique);
        Assert.Equal("[PaymentItemId] IS NOT NULL", itemIndex.GetFilter());
        var refund = model.FindEntityType(typeof(RefundRecord))!;
        var refundIndex = Assert.Single(refund.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(["CancellationFinancialResolutionId"]));
        Assert.True(refundIndex.IsUnique);
        Assert.Equal("[CancellationFinancialResolutionId] IS NOT NULL", refundIndex.GetFilter());
        var refundFk = Assert.Single(refund.GetForeignKeys(), f => f.Properties.Single().Name == "CancellationFinancialResolutionId");
        Assert.Equal(DeleteBehavior.NoAction, refundFk.DeleteBehavior);
        Assert.False(refundFk.IsRequired);
        Assert.Equal(2, entity.GetCheckConstraints().Count());
    }

    private static CancellationFinancialResolution Resolution(int id = 1) => new()
    {
        ReservationId = id, PaymentId = id, PropertyId = 1, ReservationFinancialSnapshotId = id,
        OriginalPropertyPayableEntryId = id, GrossPaidAmount = 100, Currency = "IRR", GuestRefundAmount = 100,
        Mode = CancellationFinancialResolutionMode.AutomaticFullRefundV1, Reason = "Final cancellation allocation",
        ResolvedByUserId = 7, ResolvedAtUtc = DateTime.UtcNow,
        IdempotencyKey = $"resolution-{id}", RequestFingerprint = new string('a', 64)
    };

    private static RefundRecord Refund(int id) => new()
    {
        PaymentId = id, ReservationId = id, PropertyId = 1, Amount = 100, Currency = "IRR",
        RefundedAtUtc = DateTime.UtcNow, ReferenceNumber = $"transfer-{id}", Reason = "External refund",
        RecordedByUserId = 7, RecordedAtUtc = DateTime.UtcNow,
        IdempotencyKey = $"refund-{id}", RequestFingerprint = new string('b', 64)
    };

    // Same relational constraint-test pattern as FinancialFoundationPersistenceTests;
    // unrelated aggregate graphs are omitted, while FK shape is verified with the SQL Server model above.
    private sealed class Database : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:;Foreign Keys=False");
        public KoochDbContext Context { get; }
        public Database()
        {
            connection.Open();
            Context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
            Context.Database.EnsureCreated();
        }
        public void Dispose() { Context.Dispose(); connection.Dispose(); }
    }
}
