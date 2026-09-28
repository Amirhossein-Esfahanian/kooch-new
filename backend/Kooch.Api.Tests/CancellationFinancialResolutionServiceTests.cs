using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CancellationFinancialResolutionServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly OriginalDueDate = new(2026, 9, 27);
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private static SettlementService Settlements(KoochDbContext db) => new(db, new Clock());
    private static CancellationFinancialResolutionService Service(KoochDbContext db) => new(db, Settlements(db), new Clock());
    private static CancellationFinancialResolutionRequest Auto(string key = "resolution-1") => new()
    {
        ReservationId = 1, Mode = CancellationFinancialResolutionMode.AutomaticFullRefundV1,
        Reason = "  cancellation allocation  ", Note = "  decision only  ", IdempotencyKey = key
    };
    private static CancellationFinancialResolutionRequest Manual(decimal guest = 50, decimal property = 40, decimal kooch = 10) =>
        Auto() with { Mode = CancellationFinancialResolutionMode.ManualOverride,
            GuestRefundAmount = guest, FinalPropertyShare = property, FinalKoochShare = kooch };
    private static MarkSettlementPaidRequest Paid() => new()
    {
        ReferenceNumber = "payout", PaidAtUtc = Now, PaymentMethod = SettlementPaymentMethod.BankTransfer
    };
    private static ReservationRefundRequest Refund() => new()
    {
        ReferenceNumber = "external-return", RefundedAt = Now.AddHours(-1), Reason = "legacy full refund", IdempotencyKey = "legacy"
    };

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Automatic_UsesPersistedAllocation_NotLivePriceOrCommission(bool session)
    {
        await using var store = await Store.CreateAsync(session);
        await using var db = store.Open();
        var result = await Service(db).ResolveAsync(Auto(), 7);
        var resolution = Assert.IsType<CancellationFinancialResolution>(result.Resolution);
        Assert.Equal(CancellationFinancialResolutionOutcome.Finalized, result.Outcome);
        Assert.Equal(100m, resolution.GrossPaidAmount);
        Assert.Equal(100m, resolution.GuestRefundAmount);
        Assert.Equal(0m, resolution.FinalPropertyShare);
        Assert.Equal(0m, resolution.FinalKoochShare);
        Assert.Equal(88m, result.OriginalPropertyShare);
        Assert.Equal(12m, result.OriginalKoochShare);
        Assert.Equal(-12m, result.KoochDelta);
        Assert.Equal("IRR", resolution.Currency);
        Assert.Equal(session ? 1 : (int?)null, resolution.PaymentItemId);
        Assert.Null(resolution.ReplacementPropertyPayableEntryId);
        var reversal = await db.FinancialEntries.SingleAsync(e => e.Id == resolution.ReversalFinancialEntryId);
        Assert.Equal(-88m, reversal.Amount);
        Assert.Equal(1, reversal.ReversesEntryId);
        Assert.Equal(88m, (await db.FinancialEntries.SingleAsync(e => e.Id == 1)).Amount);
        Assert.Equal(12m, (await db.ReservationFinancialSnapshots.SingleAsync(s => s.Id == 1)).CommissionAmount);
        Assert.Equal(session ? 300m : 100m, (await db.Payments.SingleAsync(p => p.Id == 1)).Amount);
        await AssertNoReservationOrRefundChanges(db);
    }

    [Theory]
    [InlineData(50, 40, 10)]
    [InlineData(0, 100, 0)]
    public async Task Manual_CreatesFullReversalAndPositiveReplacement_WithOriginalDueDate(decimal guest, decimal property, decimal kooch)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        // The immutable resolution's first insert must already contain both posting IDs.
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RequirePostingLinks BEFORE INSERT ON CancellationFinancialResolutions
            WHEN NEW.ReversalFinancialEntryId IS NULL OR NEW.ReplacementPropertyPayableEntryId IS NULL
            BEGIN SELECT RAISE(ABORT, 'missing posting links'); END;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RejectResolutionUpdate BEFORE UPDATE ON CancellationFinancialResolutions
            BEGIN SELECT RAISE(ABORT, 'resolution updated'); END;
            """);
        var result = await Service(db).ResolveAsync(Manual(guest, property, kooch), 7);
        var resolution = result.Resolution!;
        Assert.Equal(guest, resolution.GuestRefundAmount);
        Assert.Equal(property, resolution.FinalPropertyShare);
        Assert.Equal(kooch, resolution.FinalKoochShare);
        var replacement = await db.FinancialEntries.SingleAsync(e => e.Id == resolution.ReplacementPropertyPayableEntryId);
        var reversal = await db.FinancialEntries.SingleAsync(e => e.Id == resolution.ReversalFinancialEntryId);
        Assert.Equal(FinancialEntryType.PropertyPayable, replacement.EntryType);
        Assert.Equal(property, replacement.Amount);
        Assert.Null(replacement.ReversesEntryId);
        Assert.Equal(OriginalDueDate, replacement.PayableDueDate);
        Assert.Equal(1, replacement.PropertyId);
        Assert.Equal(1, replacement.ReservationId);
        Assert.Equal(1, replacement.PaymentId);
        Assert.Null(replacement.PaymentItemId);
        Assert.Equal("IRR", replacement.Currency);
        Assert.Contains("replacement", replacement.Reason);
        Assert.Equal("cancellation:payment:1:reservation:1:replacement", replacement.CorrelationKey);
        Assert.Equal("cancellation:payment:1:reservation:1:reversal", reversal.CorrelationKey);
        Assert.Equal(property, 88m + reversal.Amount + replacement.Amount);
        Assert.DoesNotContain(await db.FinancialEntries.ToListAsync(), e => e.EntryType is FinancialEntryType.Commission or FinancialEntryType.Adjustment);
        Assert.DoesNotContain((await Settlements(db).ListPayablesAsync(new())).Items, i => i.Id == 1);
        Assert.Contains((await Settlements(db).ListPayablesAsync(new())).Items, i => i.Id == replacement.Id);
        await AssertNoReservationOrRefundChanges(db);

        // Financialization retries must still find the original recognition after replacement exists.
        await new PaymentFinancializationService(db, new CommissionPolicyResolver(db)).ApplyAsync(
            await db.Reservations.SingleAsync(r => r.Id == 1), await db.Payments.SingleAsync(p => p.Id == 1), null, 100, Now.UtcDateTime);
        await db.SaveChangesAsync();
        Assert.Equal(4, await db.FinancialEntries.CountAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UnchangedPropertyShare_DoesNotPostOrDisturbAnUnpaidBatch(bool allocate)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = allocate ? await Settlements(db).CreateAsync(1, [1, 2]) : null;
        var resolution = (await Service(db).ResolveAsync(Manual(5, 88, 7), 7)).Resolution!;
        Assert.Null(resolution.ReversalFinancialEntryId);
        Assert.Null(resolution.ReplacementPropertyPayableEntryId);
        Assert.Null(resolution.ReleasedSettlementId);
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
        if (batch is not null)
        {
            Assert.Null(batch.CancelledAtUtc);
            Assert.All(batch.Items, i => Assert.Null(i.ReleasedAtUtc));
        }
    }

    [Fact]
    public async Task ChangedPropertyShare_ReleasesWholeUnpaidBatch_HealthyItemsCanBeRebatched()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1, 2]);
        var originalTotal = batch.TotalAmount;
        var resolution = (await Service(db).ResolveAsync(Manual(), 7)).Resolution!;
        Assert.Equal(batch.Id, resolution.ReleasedSettlementId);
        Assert.NotNull(batch.CancelledAtUtc);
        Assert.Null(batch.PaidAtUtc);
        Assert.Equal(originalTotal, batch.TotalAmount);
        Assert.All(batch.Items, i => Assert.Equal(batch.CancelledAtUtc, i.ReleasedAtUtc));
        Assert.Equal(new[] { "R-100001", "R-100002" }, batch.Items.OrderBy(i => i.Id).Select(i => i.ReservationNumberSnapshot));
        var rebatched = await Settlements(db).CreateAsync(1, [2, resolution.ReplacementPropertyPayableEntryId!.Value]);
        Assert.Equal(128m, rebatched.TotalAmount);
        Assert.Equal(4, await db.SettlementItems.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Settlements(db).CreateAsync(1, [1]));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PaidBatch_RejectsCorrectionAndPreservesConservativeUnchangedShareBoundary(bool unchanged)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1]);
        await Settlements(db).MarkPaidAsync(batch.Id, Paid(), 7);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ResolveAsync(
            unchanged ? Manual(5, 88, 7) : Manual(), 7));
        Assert.Contains("PostSettlementNettingRequired", error.Message);
        Assert.NotNull(batch.PaidAtUtc);
        Assert.Null(batch.CancelledAtUtc);
        Assert.Single(await db.SettlementPaymentRecords.ToListAsync());
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
        await AssertNoReservationOrRefundChanges(db);
    }

    [Theory]
    [InlineData(-1, 89, 12)]
    [InlineData(50, -1, 51)]
    [InlineData(50, 51, -1)]
    [InlineData(50, 40, 9)]
    [InlineData(50.001, 39.999, 10)]
    public async Task InvalidAllocation_FailsBeforeAnyWrites(decimal guest, decimal property, decimal kooch)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ResolveAsync(Manual(guest, property, kooch), 7));
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task DecisionMetadata_RejectsInvalidModeMissingAmountsAndAutomaticOverrides()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        foreach (var request in new[] { Auto() with { Mode = (CancellationFinancialResolutionMode)99 },
                     Manual() with { FinalPropertyShare = null }, Auto() with { GuestRefundAmount = 100 },
                     Auto() with { Reason = " " }, Auto() with { IdempotencyKey = " " } })
            await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ResolveAsync(request, 7));
        var properties = typeof(CancellationFinancialResolutionRequest).GetProperties().Select(p => p.Name).ToArray();
        Assert.DoesNotContain("GrossPaidAmount", properties);
        Assert.DoesNotContain("PaymentId", properties);
        Assert.DoesNotContain("Currency", properties);
        Assert.DoesNotContain("OriginalPropertyPayableEntryId", properties);
    }

    [Fact]
    public async Task Idempotency_NormalizesMetadataAndDecimalScale_RejectsChangedDecisionAndDifferentKey()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var first = (await Service(db).ResolveAsync(Manual(), 7)).Resolution!;
        var replay = (await Service(db).ResolveAsync(Manual(50.00m, 40.0m, 10.00m) with
            { Reason = "cancellation allocation", Note = "decision only", IdempotencyKey = " resolution-1 " }, 8)).Resolution!;
        Assert.Equal(first.Id, replay.Id);
        Assert.Equal(7, replay.ResolvedByUserId);
        foreach (var changed in new[] { Manual(51, 39, 10), Auto(), Manual() with { Reason = "different" },
                     Manual() with { Note = "different" }, Manual() with { IdempotencyKey = "another" } })
            await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ResolveAsync(changed, 7));
        Assert.Single(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Equal(4, await db.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task OriginalLookup_UsesRecognitionCorrelation_NotTheOnlyPayable()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        db.FinancialEntries.Add(new() { PropertyId = 1, ReservationId = 1, PaymentId = 1,
            EntryType = FinancialEntryType.PropertyPayable, Amount = 1, Currency = "IRR", CorrelationKey = "other-recognition" });
        await db.SaveChangesAsync();
        var result = await Service(db).ResolveAsync(Auto(), 7);
        Assert.Equal(1, result.Resolution!.OriginalPropertyPayableEntryId);
        Assert.Equal(88m, result.OriginalPropertyShare);
    }

    [Theory]
    [InlineData("missing-snapshot")]
    [InlineData("missing-payable")]
    [InlineData("snapshot-currency")]
    [InlineData("snapshot-share")]
    [InlineData("payable-link")]
    [InlineData("allocation-currency")]
    [InlineData("unsuccessful")]
    public async Task InconsistentSources_FailWithoutPosting(string defect)
    {
        await using var store = await Store.CreateAsync(session: true);
        await using var db = store.Open();
        var sql = defect switch
        {
            "missing-snapshot" => "DELETE FROM ReservationFinancialSnapshots WHERE Id=1",
            "missing-payable" => "DELETE FROM FinancialEntries WHERE Id=1",
            "snapshot-currency" => "UPDATE ReservationFinancialSnapshots SET Currency='USD' WHERE Id=1",
            "snapshot-share" => "UPDATE ReservationFinancialSnapshots SET CommissionAmount=99 WHERE Id=1",
            "payable-link" => "UPDATE FinancialEntries SET PaymentItemId=2 WHERE Id=1",
            "allocation-currency" => "UPDATE PaymentItems SET Currency='USD' WHERE Id=1",
            _ => "UPDATE Payments SET Status=0 WHERE Id=1"
        };
        await db.Database.ExecuteSqlRawAsync(sql);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ResolveAsync(Auto(), 7));
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.False(await db.FinancialEntries.AnyAsync(e => e.EntryType == FinancialEntryType.Reversal));
    }

    [Fact]
    public async Task LegacyFullRefund_IsRecognizedWithoutManufacturingResolutionOrAnotherCorrection()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var refund = await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1, Refund(), 7);
        var result = await Service(db).ResolveAsync(Auto(), 7);
        Assert.Equal(CancellationFinancialResolutionOutcome.AlreadyHandledByLegacyRefundV1, result.Outcome);
        Assert.Equal(refund.Id, result.LegacyRefundRecordId);
        Assert.Null(result.Resolution);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Equal(3, await db.FinancialEntries.CountAsync());
        Assert.Null((await db.RefundRecords.SingleAsync()).CancellationFinancialResolutionId);
    }

    [Theory]
    [InlineData("missing-reversal")]
    [InlineData("wrong-refund")]
    [InlineData("orphan-reversal")]
    public async Task InconsistentLegacyFacts_AreRejected(string defect)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1, Refund(), 7);
        await db.Database.ExecuteSqlRawAsync(defect switch
        {
            "missing-reversal" => "DELETE FROM FinancialEntries WHERE ReversesEntryId=1",
            "wrong-refund" => "UPDATE RefundRecords SET Amount=1",
            _ => "DELETE FROM RefundRecords"
        });
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ResolveAsync(Auto(), 7));
        Assert.Contains("inconsistent", error.Message);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task CapacityLost_NoPayableRemainsOnStandaloneRefundPath()
    {
        await using var store = await Store.CreateAsync(noPayable: true);
        await using var db = store.Open();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ResolveAsync(Auto(), 7));
        await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1, Refund(), 7);
        Assert.Single(await db.RefundRecords.ToListAsync());
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.FinancialEntries.ToListAsync());
    }

    [Fact]
    public async Task FailureAtResolutionInsert_RollsBackPostingsAndEntireBatchRelease()
    {
        await using var store = await Store.CreateAsync();
        await using (var db = store.Open())
        {
            await Settlements(db).CreateAsync(1, [1, 2]);
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER FailResolution BEFORE INSERT ON CancellationFinancialResolutions
                BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
                """);
            await Assert.ThrowsAsync<DbUpdateException>(() => Service(db).ResolveAsync(Manual(), 7));
        }
        await using var verify = store.Open();
        Assert.Null((await verify.Settlements.SingleAsync()).CancelledAtUtc);
        Assert.All(await verify.SettlementItems.ToListAsync(), i => Assert.Null(i.ReleasedAtUtc));
        Assert.Equal(2, await verify.FinancialEntries.CountAsync());
        Assert.Empty(await verify.CancellationFinancialResolutions.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CallerOwnedTransaction_ComposesWithoutInnerCommit(bool commit)
    {
        await using var store = await Store.CreateAsync();
        await using (var db = store.Open())
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            await Service(db).ResolveAsync(Manual(), 7);
            Assert.Same(transaction, db.Database.CurrentTransaction);
            // Stand-in for the NEXT task's orchestrator, not service behavior.
            var reservation = await db.Reservations.SingleAsync(r => r.Id == 1);
            reservation.Status = ReservationStatus.Cancelled;
            await db.SaveChangesAsync();
            if (commit) await transaction.CommitAsync();
            else await transaction.RollbackAsync();
        }
        await using var verify = store.Open();
        Assert.Equal(commit ? 1 : 0, await verify.CancellationFinancialResolutions.CountAsync());
        Assert.Equal(commit ? 4 : 2, await verify.FinancialEntries.CountAsync());
        Assert.Equal(commit ? ReservationStatus.Cancelled : ReservationStatus.Confirmed,
            (await verify.Reservations.SingleAsync(r => r.Id == 1)).Status);
    }

    [Theory]
    [InlineData("same-key")]
    [InlineData("different-key")]
    [InlineData("create")]
    [InlineData("paid")]
    public async Task ConcurrentTransactions_CannotDoublePostOrPayCorrectedOriginal(string competitor)
    {
        await using var store = await Store.CreateAsync();
        var batchId = 0;
        if (competitor == "paid")
        {
            await using var setup = store.Open();
            batchId = (await Settlements(setup).CreateAsync(1, [1])).Id;
        }
        using var start = new Barrier(2);
        async Task<Exception?> Run(bool resolve)
        {
            await using var db = store.Open();
            Assert.True(start.SignalAndWait(TimeSpan.FromSeconds(15)));
            try
            {
                if (resolve || competitor is "same-key" or "different-key")
                    await Service(db).ResolveAsync(Manual() with { IdempotencyKey = !resolve && competitor == "different-key" ? "other" : "resolution-1" }, 7);
                else if (competitor == "create") await Settlements(db).CreateAsync(1, [1]);
                else await Settlements(db).MarkPaidAsync(batchId, Paid(), 7);
                return null;
            }
            catch (InvalidOperationException error) { return error; }
        }
        var outcomes = await Task.WhenAll(Task.Run(() => Run(true)), Task.Run(() => Run(false)));
        Assert.Contains(outcomes, e => e is null);
        await using var verify = store.Open();
        var resolved = await verify.CancellationFinancialResolutions.AnyAsync();
        if (resolved)
        {
            Assert.Single(await verify.CancellationFinancialResolutions.ToListAsync());
            Assert.Equal(1, await verify.FinancialEntries.CountAsync(e => e.EntryType == FinancialEntryType.Reversal));
            Assert.Equal(1, await verify.FinancialEntries.CountAsync(e => e.CorrelationKey.EndsWith(":replacement")));
            Assert.False(await verify.SettlementItems.AnyAsync(i => i.FinancialEntryId == 1 && i.ReleasedAtUtc == null));
            Assert.False(await verify.Settlements.AnyAsync(s => s.PaidAtUtc != null));
        }
        else
        {
            Assert.Equal("paid", competitor);
            Assert.True(await verify.Settlements.AnyAsync(s => s.PaidAtUtc != null));
            Assert.Equal(2, await verify.FinancialEntries.CountAsync());
        }
        if (competitor == "same-key") Assert.All(outcomes, Assert.Null);
        if (competitor == "different-key") Assert.Single(outcomes, e => e is not null);
    }

    private static async Task AssertNoReservationOrRefundChanges(KoochDbContext db)
    {
        var reservation = await db.Reservations.AsNoTracking().SingleAsync(r => r.Id == 1);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Null(reservation.CancelledAtUtc);
        Assert.Null(reservation.CancelledByUserId);
        Assert.Null(reservation.CancellationReason);
        Assert.Null(reservation.CancellationNote);
        Assert.Empty(await db.NotificationLogs.ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Equal(PaymentStatus.Successful, (await db.Payments.SingleAsync(p => p.Id == 1)).Status);
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<Reservation>().Property(r => r.RowVersion).ValueGeneratedNever();
            builder.Entity<Payment>().Property(p => p.RowVersion).ValueGeneratedNever();
            builder.Entity<BookingSession>().Property(s => s.RowVersion).ValueGeneratedNever();
        }
    }
    private sealed class Store(string path) : IAsyncDisposable
    {
        public KoochDbContext Open() => new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Foreign Keys=False;Pooling=False;Default Timeout=15").Options);
        public static async Task<Store> CreateAsync(bool session = false, bool noPayable = false)
        {
            var store = new Store(Path.Combine(Path.GetTempPath(), $"kooch-resolution-{Guid.NewGuid():N}.db"));
            await using var db = store.Open();
            await db.Database.EnsureCreatedAsync();
            db.Properties.Add(new() { Id = 1, Name = "Property", Slug = "property" });
            db.SiteSettings.AddRange(new SiteSetting { Key = CommissionPolicyResolver.DirectSettingKey, Value = "99" },
                new SiteSetting { Key = SettlementPolicy.OffsetDaysKey, Value = "999" });
            if (session) db.BookingSessions.Add(new() { Id = 1, PropertyId = 1, Currency = "IRR", SessionCode = "O-100001" });
            for (var id = 1; id <= 2; id++)
            {
                var gross = session && id == 2 ? 200m : 100m;
                db.Reservations.Add(new() { Id = id, PropertyId = 1, ReservationNumber = $"R-{100000 + id}",
                    FinalAmount = 9999, BookingSessionId = session ? 1 : null,
                    Status = noPayable ? ReservationStatus.CapacityLost : ReservationStatus.Confirmed });
                if (session) db.PaymentItems.Add(new() { Id = id, PaymentId = 1, ReservationId = id,
                    AllocatedAmount = gross, Currency = "IRR" });
                else db.Payments.Add(new() { Id = id, ReservationId = id, Amount = gross,
                    Currency = "IRR", Status = PaymentStatus.Successful });
                if (noPayable) continue;
                db.ReservationFinancialSnapshots.Add(new() { Id = id, ReservationId = id, PropertyId = 1,
                    PaymentId = session ? 1 : id, PaymentItemId = session ? id : null, Currency = "IRR",
                    GrossAmount = gross, CommissionBase = gross, PropertyPayableAmount = 88, CommissionAmount = gross - 88 });
                db.FinancialEntries.Add(new() { Id = id, PropertyId = 1, ReservationId = id,
                    PaymentId = session ? 1 : id, PaymentItemId = session ? id : null, Currency = "IRR", Amount = 88,
                    EntryType = FinancialEntryType.PropertyPayable, PayableDueDate = OriginalDueDate,
                    CorrelationKey = $"payment:{(session ? 1 : id)}:reservation:{id}" });
            }
            if (session) db.Payments.Add(new() { Id = 1, BookingSessionId = 1, Amount = 300, Currency = "IRR", Status = PaymentStatus.Successful });
            await db.SaveChangesAsync();
            return store;
        }
        public ValueTask DisposeAsync() { File.Delete(path); return ValueTask.CompletedTask; }
    }
}
