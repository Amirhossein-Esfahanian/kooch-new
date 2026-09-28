using System.Reflection;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Kooch.Api.Migrations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationRefundTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private static ReservationRefundRequest Request(string key = "refund-1") => new()
    {
        ReferenceNumber = "  bank-ref  ", RefundedAt = Now.AddHours(-1), Reason = "  Full return  ",
        Note = "  recorded externally  ", IdempotencyKey = key
    };
    private static MarkSettlementPaidRequest PaidRequest() => new()
    {
        ReferenceNumber = "payout", PaidAtUtc = Now, PaymentMethod = SettlementPaymentMethod.BankTransfer
    };
    private static SettlementService Settlements(KoochDbContext db) => new(db, new Clock());
    private static ReservationRefundService Refunds(KoochDbContext db) => new(db, Settlements(db), new Clock());

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FullRefund_UsesOriginalAllocationAndPreservesAllOriginalFacts(bool session)
    {
        await using var store = await Store.CreateAsync(session: session);
        await using var db = store.Open();
        var reservation = await db.Reservations.SingleAsync(r => r.Id == 1);
        reservation.FinalAmount = 99999;
        await db.SaveChangesAsync();
        var result = await Refunds(db).RecordAsync(1, Request(), 7);
        Assert.Equal(100.01m, result.Amount);
        Assert.Equal("IRR", result.Currency);
        Assert.Equal("bank-ref", result.ReferenceNumber);
        Assert.Equal(Now.AddHours(-1).UtcDateTime, result.RefundedAtUtc);
        var record = await db.RefundRecords.SingleAsync();
        Assert.Equal(1, record.PropertyId);
        Assert.Equal(1, record.ReservationFinancialSnapshotId);
        Assert.Equal(1, record.OriginalPropertyPayableEntryId);
        Assert.Equal(session ? 1 : (int?)null, record.PaymentItemId);
        var original = await db.FinancialEntries.SingleAsync(e => e.Id == 1);
        Assert.Equal(87.67m, original.Amount);
        Assert.Equal("payable:1", original.CorrelationKey);
        var reversal = await db.FinancialEntries.SingleAsync(e => e.EntryType == FinancialEntryType.Reversal);
        Assert.Equal(-87.67m, reversal.Amount);
        Assert.Equal(0, original.Amount + reversal.Amount);
        Assert.Equal(original.Id, reversal.ReversesEntryId);
        Assert.Equal(original.Currency, reversal.Currency);
        Assert.Equal(original.PropertyId, reversal.PropertyId);
        Assert.Equal(original.PaymentId, reversal.PaymentId);
        Assert.Equal(original.PaymentItemId, reversal.PaymentItemId);
        Assert.Equal(original.ReservationId, reversal.ReservationId);
        Assert.Equal("Full return", reversal.Reason);
        Assert.Equal("refund:payment:1:reservation:1", reversal.CorrelationKey);
        var payment = await db.Payments.SingleAsync(p => p.Id == 1);
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.Equal(session ? 300.01m : 100.01m, payment.Amount);
        Assert.Equal(87.67m, (await db.ReservationFinancialSnapshots.SingleAsync(s => s.Id == 1)).PropertyPayableAmount);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Equal(2, await db.ReservationFinancialSnapshots.CountAsync());
    }

    [Fact]
    public async Task Idempotency_ExactRetryReturnsRecord_ChangedPayloadOrKeyConflicts()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var first = await Refunds(db).RecordAsync(1, Request(), 7);
        Assert.Equal(first, await Refunds(db).RecordAsync(1, Request(), 8));
        var changed = Request(); changed.Reason = "Different";
        await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(1, changed, 7));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(1, Request("other"), 7));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(2, Request(), 7));
        Assert.Equal(1, await db.RefundRecords.CountAsync());
        Assert.Equal(1, await db.FinancialEntries.CountAsync(e => e.EntryType == FinancialEntryType.Reversal));
    }

    [Fact]
    public async Task UnpaidBatch_EntireBatchReleased_OtherItemCanBeRebatched_ReversedItemCannot()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1, 2]);
        var total = batch.TotalAmount;
        await Refunds(db).RecordAsync(1, Request(), 7);
        Assert.Equal(total, batch.TotalAmount);
        Assert.Equal(SettlementStatus.Cancelled, batch.GetStatus(DateOnly.FromDateTime(Now.UtcDateTime)));
        Assert.All(batch.Items, i => Assert.Equal(batch.CancelledAtUtc, i.ReleasedAtUtc));
        Assert.Equal(new[] { "R-100001", "R-100002" }, batch.Items.OrderBy(i => i.Id).Select(i => i.ReservationNumberSnapshot));
        Assert.Equal(2, Assert.Single((await Settlements(db).ListPayablesAsync(new())).Items).Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Settlements(db).CreateAsync(1, [1]));
        var replacement = await Settlements(db).CreateAsync(1, [2]);
        Assert.Equal(2, Assert.Single(replacement.Items).FinancialEntryId);
        Assert.Equal(3, await db.SettlementItems.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Settlements(db).MarkPaidAsync(batch.Id, PaidRequest(), 7));
    }

    [Fact]
    public async Task FailureAfterCancellation_RollsBackReleaseRefundAndReversalTogether()
    {
        await using var store = await Store.CreateAsync();
        int batchId;
        await using (var db = store.Open())
        {
            batchId = (await Settlements(db).CreateAsync(1, [1, 2])).Id;
            // Force the final insert to fail after the cancellation's SaveChanges has completed.
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER RejectRefund BEFORE INSERT ON RefundRecords BEGIN SELECT RAISE(ABORT, 'forced failure'); END;");
            await Assert.ThrowsAsync<DbUpdateException>(() => Refunds(db).RecordAsync(1, Request(), 7));
        }
        await using var verify = store.Open();
        var batch = await Settlements(verify).GetAsync(batchId);
        Assert.Null(batch.CancelledAtUtc);
        Assert.All(batch.Items, i => Assert.Null(i.ReleasedAtUtc));
        Assert.Empty(await verify.RefundRecords.ToListAsync());
        Assert.DoesNotContain(await verify.FinancialEntries.ToListAsync(), e => e.EntryType == FinancialEntryType.Reversal);
    }

    [Fact]
    public async Task PaidBatch_RequiresNettingAndChangesNothing()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1]);
        await Settlements(db).MarkPaidAsync(batch.Id, PaidRequest(), 7);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(1, Request(), 7));
        Assert.Contains("Post-settlement refund requires future netting support", error.Message);
        Assert.NotNull(batch.PaidAtUtc);
        Assert.Null(batch.CancelledAtUtc);
        Assert.Single(await db.SettlementPaymentRecords.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CapacityLost_RecordsGuestRefundWithRealPropertyAndNoInventedFinancialization(bool session)
    {
        await using var store = await Store.CreateAsync(session: session, noPayable: true);
        await using var db = store.Open();
        await Refunds(db).RecordAsync(1, Request(), 7);
        var record = await db.RefundRecords.SingleAsync();
        Assert.Null(record.ReservationFinancialSnapshotId);
        Assert.Null(record.OriginalPropertyPayableEntryId);
        Assert.Equal(1, record.PropertyId);
        Assert.Equal(100.01m, record.Amount);
        Assert.Empty(await db.FinancialEntries.ToListAsync());
        Assert.Empty(await db.ReservationFinancialSnapshots.ToListAsync());
        Assert.Equal(ReservationStatus.CapacityLost, (await db.Reservations.SingleAsync(r => r.Id == 1)).Status);
    }

    [Theory]
    [InlineData("snapshot-currency")]
    [InlineData("allocation-currency")]
    [InlineData("missing-payable")]
    [InlineData("missing-snapshot")]
    [InlineData("already-reversed")]
    [InlineData("not-successful")]
    public async Task InconsistentOrIneligibleFacts_FailClosed(string defect)
    {
        await using var store = await Store.CreateAsync(session: true);
        await using var db = store.Open();
        // Corrupt legacy facts via SQL, not by bypassing the production EF immutability guard.
        var sql = defect switch
        {
            "snapshot-currency" => "UPDATE ReservationFinancialSnapshots SET Currency='USD' WHERE Id=1",
            "allocation-currency" => "UPDATE PaymentItems SET Currency='USD' WHERE Id=1",
            "missing-payable" => "DELETE FROM FinancialEntries WHERE Id=1",
            "missing-snapshot" => "DELETE FROM ReservationFinancialSnapshots WHERE Id=1",
            "not-successful" => "UPDATE Payments SET Status=0 WHERE Id=1",
            _ => null
        };
        if (sql is not null) await db.Database.ExecuteSqlRawAsync(sql);
        else
        {
            db.FinancialEntries.Add(Reversal());
            await db.SaveChangesAsync();
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(1, Request(), 7));
        Assert.Empty(await db.RefundRecords.ToListAsync());
    }

    [Fact]
    public async Task ReversalUniqueIndexIsDatabaseEnforced_AndMarkPaidRechecksEligibility()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1]);
        db.FinancialEntries.Add(Reversal()); await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Settlements(db).MarkPaidAsync(batch.Id, PaidRequest(), 7));
        var duplicate = Reversal(); duplicate.CorrelationKey = "another-source";
        db.FinancialEntries.Add(duplicate);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Null(batch.PaidAtUtc);
    }

    [Theory]
    [InlineData("refund-change")]
    [InlineData("refund-delete")]
    [InlineData("refund-soft-delete")]
    [InlineData("reversal")]
    [InlineData("payment-amount")]
    [InlineData("payment-currency")]
    [InlineData("payment-status")]
    [InlineData("payment-delete")]
    [InlineData("allocation-amount")]
    [InlineData("allocation-delete")]
    [InlineData("allocation-add")]
    public async Task HistoricalFacts_AreImmutable(string mutation)
    {
        await using var store = await Store.CreateAsync(session: true);
        await using var db = store.Open();
        await Refunds(db).RecordAsync(1, Request(), 7);
        var record = await db.RefundRecords.SingleAsync();
        var payment = await db.Payments.SingleAsync(p => p.Id == 1);
        var item = await db.PaymentItems.SingleAsync(i => i.Id == 1);
        switch (mutation)
        {
            case "refund-change": record.Amount = 1; break;
            case "refund-delete": db.Remove(record); break;
            case "refund-soft-delete": record.IsDeleted = true; break;
            case "reversal": (await db.FinancialEntries.SingleAsync(e => e.EntryType == FinancialEntryType.Reversal)).Amount = -1; break;
            case "payment-amount": payment.Amount = 1; break;
            case "payment-currency": payment.Currency = "USD"; break;
            case "payment-status": payment.Status = PaymentStatus.Refunded; break;
            case "payment-delete":
                db.ChangeTracker.Clear();
                db.Remove(await db.Payments.SingleAsync(p => p.Id == 1));
                break;
            case "allocation-amount": item.AllocatedAmount = 1; break;
            case "allocation-delete": db.Remove(item); break;
            case "allocation-add": db.PaymentItems.Add(new() { PaymentId = 1, ReservationId = 3, AllocatedAmount = 1, Currency = "IRR" }); break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task SuccessfulPayment_ProcessingMetadataStillEditable()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var payment = await db.Payments.SingleAsync(p => p.Id == 1);
        payment.ProviderConfirmedAtUtc = Now.UtcDateTime;
        payment.AppliedAtUtc = Now.UtcDateTime;
        payment.ProcessingError = "retry metadata";
        await db.SaveChangesAsync();
        Assert.Equal(Now.UtcDateTime, payment.AppliedAtUtc);
    }

    [Fact]
    public void Endpoint_IsAdminManagePayments_AndRequestCannotCarryFinancialFacts()
    {
        var type = typeof(AdminReservationRefundsController);
        Assert.Contains(type.GetCustomAttributes(), a => a.GetType().Name == "AdminAuthorizeAttribute");
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ManagePayments).Policy,
            type.GetCustomAttribute<PermissionAuthorizeAttribute>()!.Policy);
        Assert.Equal(new[] { "IdempotencyKey", "Note", "Reason", "ReferenceNumber", "RefundedAt" },
            typeof(ReservationRefundRequest).GetProperties().Select(p => p.Name).Order());
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ReservationRefundRequest>("{\"amount\":5}"));
    }

    [Fact]
    public void Migration_OnlyAddsRefundHistoryAndFullReversalUniqueness()
    {
        var operations = new AddFullReservationRefund().UpOperations;
        var table = Assert.Single(operations.OfType<CreateTableOperation>());
        Assert.Equal("RefundRecords", table.Name);
        Assert.Equal("decimal(18,2)", table.Columns.Single(c => c.Name == "Amount").ColumnType);
        Assert.DoesNotContain(operations, o => o is AlterColumnOperation or AddColumnOperation or SqlOperation);
        var index = Assert.Single(operations.OfType<CreateIndexOperation>(), i => i.Table == "FinancialEntries");
        Assert.True(index.IsUnique);
        Assert.Equal(5, (int)FinancialEntryType.Reversal);
        Assert.Equal("[EntryType] = 5 AND [ReversesEntryId] IS NOT NULL", index.Filter);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RefundUniqueness_IsDatabaseEnforced(bool duplicateKey)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Refunds(db).RecordAsync(1, Request(), 7);
        var existing = await db.RefundRecords.AsNoTracking().SingleAsync();
        existing.Id = 0;
        existing.OriginalPropertyPayableEntryId = null;
        existing.ReservationFinancialSnapshotId = null;
        if (duplicateKey) { existing.PaymentId = 2; existing.ReservationId = 2; }
        else existing.IdempotencyKey = "different-key";
        db.Add(existing);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Theory]
    [InlineData("create")]
    [InlineData("paid")]
    [InlineData("refund")]
    public async Task ConcurrentTransactions_RefundCannotLeaveAnActiveOrPaidReversedAllocation(string competitor)
    {
        await using var store = await Store.CreateAsync();
        var batchId = 0;
        if (competitor == "paid")
        {
            await using var prepare = store.Open();
            batchId = (await Settlements(prepare).CreateAsync(1, [1])).Id;
        }
        using var start = new Barrier(2);
        async Task<Exception?> Run(bool refund)
        {
            await using var db = store.Open();
            Assert.True(start.SignalAndWait(TimeSpan.FromSeconds(15)));
            try
            {
                if (refund || competitor == "refund") await Refunds(db).RecordAsync(1, Request(), 7);
                else if (competitor == "create") await Settlements(db).CreateAsync(1, [1]);
                else await Settlements(db).MarkPaidAsync(batchId, PaidRequest(), 7);
                return null;
            }
            catch (InvalidOperationException error) { return error; }
        }
        var results = await Task.WhenAll(Task.Run(() => Run(true)), Task.Run(() => Run(false)));
        Assert.Contains(results, error => error is null);
        await using var verify = store.Open();
        var refunded = await verify.RefundRecords.AnyAsync();
        Assert.Equal(refunded ? 1 : 0, await verify.FinancialEntries.CountAsync(e => e.EntryType == FinancialEntryType.Reversal));
        if (refunded)
        {
            Assert.False(await verify.SettlementItems.AnyAsync(i => i.FinancialEntryId == 1 && i.ReleasedAtUtc == null));
            Assert.False(await verify.Settlements.AnyAsync(s => s.PaidAtUtc != null));
        }
        else Assert.True(await verify.Settlements.AnyAsync(s => s.PaidAtUtc != null));
        if (competitor == "refund") Assert.All(results, Assert.Null);
    }

    private static FinancialEntry Reversal() => new()
    {
        PropertyId = 1, ReservationId = 1, PaymentId = 1, EntryType = FinancialEntryType.Reversal,
        ReversesEntryId = 1, Amount = -87.67m, Currency = "IRR", CorrelationKey = "prior-reversal", Reason = "prior refund"
    };

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<Reservation>().Property(r => r.RowVersion).ValueGeneratedNever();
            modelBuilder.Entity<Payment>().Property(p => p.RowVersion).ValueGeneratedNever();
            modelBuilder.Entity<BookingSession>().Property(s => s.RowVersion).ValueGeneratedNever();
        }
    }

    private sealed class Store(string path) : IAsyncDisposable
    {
        public KoochDbContext Open() => new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Foreign Keys=False;Pooling=False;Default Timeout=15").Options);
        public static async Task<Store> CreateAsync(bool session = false, bool noPayable = false)
        {
            var store = new Store(Path.Combine(Path.GetTempPath(), $"kooch-refund-{Guid.NewGuid():N}.db"));
            await using var db = store.Open();
            await db.Database.EnsureCreatedAsync();
            db.Properties.Add(new() { Id = 1, Name = "Property", Slug = "property" });
            if (session) db.BookingSessions.Add(new() { Id = 1, PropertyId = 1, Currency = "IRR", SessionCode = "O-100001" });
            for (var id = 1; id <= 2; id++)
            {
                db.Reservations.Add(new()
                {
                    Id = id, PropertyId = 1, ReservationNumber = $"R-{100000 + id}", FinalAmount = 100.01m,
                    Status = noPayable ? ReservationStatus.CapacityLost : ReservationStatus.Confirmed,
                    BookingSessionId = session ? 1 : null
                });
                if (!session) db.Payments.Add(new() { Id = id, ReservationId = id, Amount = 100.01m,
                    Status = PaymentStatus.Successful, Currency = "IRR" });
                else db.PaymentItems.Add(new() { Id = id, PaymentId = 1, ReservationId = id,
                    AllocatedAmount = id == 1 ? 100.01m : 200m, Currency = "IRR" });
                if (noPayable) continue;
                db.ReservationFinancialSnapshots.Add(new()
                {
                    Id = id, ReservationId = id, PropertyId = 1, PaymentId = session ? 1 : id,
                    PaymentItemId = session ? id : null, GrossAmount = session && id == 2 ? 200m : 100.01m,
                    Currency = "IRR", PropertyPayableAmount = 87.67m, CommissionAmount = 12.34m
                });
                db.FinancialEntries.Add(new()
                {
                    Id = id, ReservationId = id, PropertyId = 1, PaymentId = session ? 1 : id,
                    PaymentItemId = session ? id : null, Amount = 87.67m, Currency = "IRR",
                    EntryType = FinancialEntryType.PropertyPayable, CorrelationKey = $"payable:{id}",
                    PayableDueDate = new DateOnly(2026, 9, 27)
                });
            }
            if (session) db.Payments.Add(new() { Id = 1, BookingSessionId = 1, Amount = 300.01m,
                Status = PaymentStatus.Successful, Currency = "IRR" });
            await db.SaveChangesAsync();
            return store;
        }
        public ValueTask DisposeAsync()
        {
            File.Delete(path);
            return ValueTask.CompletedTask;
        }
    }
}
