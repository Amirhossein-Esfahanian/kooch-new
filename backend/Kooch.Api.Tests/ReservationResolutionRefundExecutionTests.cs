using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationCancellationOrchestrationTests
{
    private static ReservationRefundService Refunds(Kooch.Api.Data.KoochDbContext db) =>
        new(db, Settlements(db), new Clock());

    private static ReservationRefundRequest Refund(string key = "refund-1") => new()
    {
        ReferenceNumber = "  00000123  ", RefundedAt = Now,
        Reason = "  bank transfer to guest  ", Note = "  execution note  ", IdempotencyKey = key
    };

    [Fact]
    public async Task ResolutionRefundUsesPersistedAmountAndCreatesOnlyLinkedExecutionRecord()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var cancellation = Service(db);
        await cancellation.CancelAsync(1, Auto(), Actor);
        var resolution = await db.CancellationFinancialResolutions.AsNoTracking().SingleAsync();
        var entryCount = await db.FinancialEntries.CountAsync();
        var original = await db.FinancialEntries.AsNoTracking().SingleAsync(e => e.Id == 1);
        var reversal = await db.FinancialEntries.AsNoTracking().SingleAsync(e => e.EntryType == FinancialEntryType.Reversal);
        var result = await Refunds(db).RecordAsync(1, Refund(), Actor.UserId);
        var record = await db.RefundRecords.AsNoTracking().SingleAsync();
        Assert.Equal(resolution.Id, record.CancellationFinancialResolutionId);
        Assert.Equal(resolution.GuestRefundAmount, record.Amount);
        Assert.Equal(resolution.Currency, record.Currency);
        Assert.Equal("00000123", record.ReferenceNumber);
        Assert.Equal(Now.UtcDateTime, record.RefundedAtUtc);
        Assert.Equal("R-100001", result.ReservationNumber);
        Assert.Equal(100m, result.Amount);
        Assert.True(result.RefundRecorded);
        Assert.Null(result.Id);
        Assert.Null(result.PaymentId);
        Assert.Null(result.PaymentItemId);
        var json = JsonSerializer.Serialize(result);
        Assert.DoesNotContain("PaymentId", json);
        Assert.DoesNotContain("PaymentItemId", json);
        Assert.DoesNotContain("\"Id\"", json);
        Assert.Equal(entryCount, await db.FinancialEntries.CountAsync());
        Assert.Equal(original.Amount, (await db.FinancialEntries.SingleAsync(e => e.Id == 1)).Amount);
        Assert.Equal(reversal.Amount, (await db.FinancialEntries.SingleAsync(e => e.Id == reversal.Id)).Amount);
        Assert.Equal(resolution.RequestFingerprint,
            (await db.CancellationFinancialResolutions.AsNoTracking().SingleAsync()).RequestFingerprint);
        var payment = await db.Payments.AsNoTracking().SingleAsync();
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.Equal(100m, payment.Amount);
        Assert.Equal(100m, (await db.ReservationFinancialSnapshots.SingleAsync()).GrossAmount);
        Assert.False((await cancellation.CancelAsync(1, Auto(), Actor)).CancellationOutcome!.RefundPending);
    }

    [Fact]
    public async Task ZeroGuestShareReturnsStableConflictWithoutCreatingRefund()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Manual(guest: 0, property: 40, kooch: 60), Actor);
        var controller = Controller(db);
        var response = await controller.Record(1, Refund(), default);
        var conflict = Assert.IsType<ConflictObjectResult>(response.Result);
        Assert.Contains("NoGuestRefundRequired", JsonSerializer.Serialize(conflict.Value));
        Assert.Empty(await db.RefundRecords.ToListAsync());
    }

    [Fact]
    public async Task NonCancelledReservationCannotExecuteExistingResolutionRefund()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await new CancellationFinancialResolutionService(db, Settlements(db), new Clock()).ResolveAsync(new()
        {
            ReservationId = 1, Mode = CancellationFinancialResolutionMode.AutomaticFullRefundV1,
            Reason = "decision", IdempotencyKey = "resolution-before-cancel"
        }, Actor.UserId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Refunds(db).RecordAsync(1, Refund(), Actor.UserId));
        Assert.Empty(await db.RefundRecords.ToListAsync());
    }

    [Fact]
    public async Task ResolutionRefundReplaysOnlyExactExecutionAndDifferentKeyConflicts()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Auto(), Actor);
        var refunds = Refunds(db);
        await refunds.RecordAsync(1, Refund(), Actor.UserId);
        var replay = await refunds.RecordAsync(1, Refund(), Actor.UserId);
        Assert.True(replay.IdempotentReplay);
        Assert.Null(replay.PaymentId);
        var changed = Refund(); changed.ReferenceNumber = "00000124";
        var changedResponse = await Controller(db).Record(1, changed, default);
        Assert.Contains("RefundIdempotencyConflict", JsonSerializer.Serialize(
            Assert.IsType<ConflictObjectResult>(changedResponse.Result).Value));
        changed = Refund(); changed.Note = "different execution note";
        await Assert.ThrowsAsync<InvalidOperationException>(() => refunds.RecordAsync(1, changed, Actor.UserId));
        var conflict = await Controller(db).Record(1, Refund("another-key"), default);
        Assert.Contains("RefundAlreadyRecorded", JsonSerializer.Serialize(
            Assert.IsType<ConflictObjectResult>(conflict.Result).Value));
        Assert.Equal(1, await db.RefundRecords.CountAsync());
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task ConcurrentResolutionRefundAttemptsPersistAtMostOneExecution()
    {
        await using var store = await Store.CreateAsync();
        await using (var setup = store.Open())
            await Service(setup).CancelAsync(1, Auto(), Actor);

        using var start = new Barrier(2);
        async Task<Exception?> Attempt()
        {
            await using var db = store.Open();
            Assert.True(start.SignalAndWait(TimeSpan.FromSeconds(15)));
            try
            {
                await Refunds(db).RecordAsync(1, Refund(), Actor.UserId);
                return null;
            }
            catch (Exception error) { return error; }
        }

        var results = await Task.WhenAll(Task.Run(Attempt), Task.Run(Attempt));
        Assert.Contains(results, error => error is null);
        Assert.All(results, error => Assert.True(error is null or InvalidOperationException ||
            error is Microsoft.Data.Sqlite.SqliteException { SqliteErrorCode: 5 or 6 } ||
            error is DbUpdateException { InnerException: Microsoft.Data.Sqlite.SqliteException { SqliteErrorCode: 5 or 6 } },
            error?.ToString()));
        await using var verify = store.Open();
        Assert.Single(await verify.RefundRecords.AsNoTracking().ToListAsync());
        Assert.Equal(2, await verify.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task DatabaseFailureBeforeCommitLeavesNoRefundRecord()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Auto(), Actor);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RejectRefund BEFORE INSERT ON RefundRecords
            BEGIN SELECT RAISE(ABORT, 'injected refund failure'); END;
            """);
        await Assert.ThrowsAnyAsync<Exception>(() => Refunds(db).RecordAsync(1, Refund(), Actor.UserId));
        db.ChangeTracker.Clear();
        Assert.Empty(await db.RefundRecords.ToListAsync());
        Assert.Equal(2, await db.FinancialEntries.CountAsync());
        Assert.Single(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RefundNeverChangesReplacementSettlementHistory(bool paidSettlement)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Manual(), Actor);
        var replacement = await db.FinancialEntries.SingleAsync(e => e.CorrelationKey!.EndsWith(":replacement"));
        var batch = await Settlements(db).CreateAsync(1, [replacement.Id], allowEarlySettlement: true);
        if (paidSettlement)
            await Settlements(db).MarkPaidAsync(batch.Id, new MarkSettlementPaidRequest
            {
                ReferenceNumber = "payout", PaidAtUtc = Now, PaymentMethod = SettlementPaymentMethod.BankTransfer
            }, Actor.UserId);
        var before = await db.Settlements.AsNoTracking().SingleAsync();
        var itemBefore = await db.SettlementItems.AsNoTracking().SingleAsync();
        await Refunds(db).RecordAsync(1, Refund(), Actor.UserId);
        var after = await db.Settlements.AsNoTracking().SingleAsync();
        var itemAfter = await db.SettlementItems.AsNoTracking().SingleAsync();
        Assert.Equal(before.PaidAtUtc, after.PaidAtUtc);
        Assert.Equal(before.CancelledAtUtc, after.CancelledAtUtc);
        Assert.Equal(itemBefore.ReleasedAtUtc, itemAfter.ReleasedAtUtc);
        Assert.Equal(40m, (await db.FinancialEntries.SingleAsync(e => e.Id == replacement.Id)).Amount);
        Assert.Equal(3, await db.FinancialEntries.CountAsync());
    }

    [Fact]
    public async Task MixedLegacyAndResolutionHistoryIsRejectedRatherThanGuessed()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Service(db).CancelAsync(1, Auto(), Actor);
        db.RefundRecords.Add(new RefundRecord
        {
            PaymentId = 1, ReservationId = 1, PropertyId = 1, ReservationFinancialSnapshotId = 1,
            OriginalPropertyPayableEntryId = 1, Amount = 100, Currency = "IRR",
            RefundedAtUtc = Now.UtcDateTime, ReferenceNumber = "legacy-reference",
            Reason = "legacy", RecordedByUserId = 1, RecordedAtUtc = Now.UtcDateTime,
            IdempotencyKey = "legacy-refund", RequestFingerprint = new string('a', 64)
        });
        await db.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Refunds(db).RecordAsync(1, Refund(), Actor.UserId));
        Assert.Contains("Inconsistent mixed refund history", error.Message);
        Assert.Single(await db.RefundRecords.ToListAsync());
    }

    [Fact]
    public void UnknownClientAmountIsRejectedByExistingRequestContract()
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ReservationRefundRequest>("""
            {"referenceNumber":"00000123","refundedAt":"2026-09-28T12:00:00Z",
             "reason":"bank transfer","idempotencyKey":"refund-1","amount":1}
            """, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private static AdminReservationRefundsController Controller(Kooch.Api.Data.KoochDbContext db)
    {
        var controller = new AdminReservationRefundsController(Refunds(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, Actor.UserId.ToString()),
             new Claim(ClaimTypes.Role, Actor.Role.ToString())], "test"));
        return controller;
    }
}
