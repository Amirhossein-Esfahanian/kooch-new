using Kooch.Api.Data;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCancellationOrchestrationTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);
    private static readonly (int UserId, UserRole Role) Actor = (1, UserRole.SuperAdmin);
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }

    private static ReservationCancellationRequest Auto(string key = "cancel-1") => new()
    {
        Reason = ReservationCancellationReason.GuestRequest, Explanation = "  guest requested cancellation  ",
        IdempotencyKey = key
    };

    private static ReservationCancellationRequest Manual(string key = "cancel-1", decimal guest = 50,
        decimal property = 40, decimal kooch = 10) => new()
    {
        Reason = ReservationCancellationReason.GuestRequest, Explanation = "guest requested cancellation",
        IdempotencyKey = key,
        FinancialResolution = new()
        {
            Mode = CancellationFinancialResolutionMode.ManualOverride,
            GuestRefundAmount = guest, FinalPropertyShare = property, FinalKoochShare = kooch,
            Note = "decision"
        }
    };

    [Fact]
    public async Task UnpaidCancellationNeedsNoFinancePermissionOrFinancialRecords()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var notifications = new RecordingNotificationService();
        var response = await Service(db, notifications, paymentsAllowed: false).CancelAsync(1, Auto(), Actor);
        Assert.Equal(ReservationStatus.Cancelled, response.Status);
        Assert.False(response.CancellationOutcome!.PaidCancellation);
        Assert.Equal("cancel-1", (await db.Reservations.SingleAsync()).CancellationIdempotencyKey);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Empty(await db.FinancialEntries.ToListAsync());
        Assert.Single(notifications.Requests);
    }

    [Fact]
    public async Task LegacyUnpaidRequestWithoutKeyRemainsAcceptedButDoesNotFabricateFinance()
    {
        await using var store = await Store.CreateAsync(paid: false);
        await using var db = store.Open();
        var request = Auto(); request.IdempotencyKey = null;
        await Service(db, paymentsAllowed: false).CancelAsync(1, request, Actor);
        var saved = await db.Reservations.SingleAsync();
        Assert.StartsWith("legacy-unpaid:", saved.CancellationIdempotencyKey);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task PaidAutomaticCancellationCommitsResolutionReversalReservationAndReplayWithoutDuplicates()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var notifications = new RecordingNotificationService();
        var service = Service(db, notifications);
        var response = await service.CancelAsync(1, Auto(), Actor);
        Assert.Equal(ReservationStatus.Cancelled, response.Status);
        Assert.Equal("guest requested cancellation", response.CancellationNote);
        Assert.True(response.CancellationOutcome!.PaidCancellation);
        Assert.Equal(100m, response.CancellationOutcome.GrossPaidAmount);
        Assert.Equal(100m, response.CancellationOutcome.GuestRefundAmount);
        Assert.Equal(0m, response.CancellationOutcome.FinalPropertyShare);
        Assert.True(response.CancellationOutcome.RefundPending);
        Assert.Single(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Single(await db.FinancialEntries.Where(e => e.EntryType == FinancialEntryType.Reversal).ToListAsync());
        Assert.Empty(await db.RefundRecords.ToListAsync());
        var reservation = await db.Reservations.SingleAsync();
        Assert.Equal("cancel-1", reservation.CancellationIdempotencyKey);
        Assert.Equal(64, reservation.CancellationRequestFingerprint!.Length);
        var replay = await service.CancelAsync(1, Auto(), Actor);
        Assert.True(replay.CancellationOutcome!.IdempotentReplay);
        Assert.Single(notifications.Requests);
        Assert.Equal(1, await db.CancellationFinancialResolutions.CountAsync());
        Assert.Equal(1, await db.FinancialEntries.CountAsync(e => e.EntryType == FinancialEntryType.Reversal));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            Service(db, paymentsAllowed: false).CancelAsync(1, Auto(), Actor));
    }

    [Fact]
    public async Task OmittedAndExplicitAutomaticModeHaveTheSameOperationFingerprint()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = Service(db);
        await service.CancelAsync(1, Auto(), Actor);
        var explicitAuto = Auto();
        explicitAuto.FinancialResolution = new()
        {
            Mode = CancellationFinancialResolutionMode.AutomaticFullRefundV1
        };
        Assert.True((await service.CancelAsync(1, explicitAuto, Actor)).CancellationOutcome!.IdempotentReplay);
    }

    [Fact]
    public async Task ManualAllocationPersistsExactSplitAndZeroRefundIsNotPending()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var result = await Service(db).CancelAsync(1, Manual(guest: 0, property: 40, kooch: 60), Actor);
        Assert.Equal(CancellationFinancialResolutionMode.ManualOverride, result.CancellationOutcome!.FinancialMode);
        Assert.Equal(0m, result.CancellationOutcome.GuestRefundAmount);
        Assert.Equal(40m, result.CancellationOutcome.FinalPropertyShare);
        Assert.Equal(60m, result.CancellationOutcome.FinalKoochShare);
        Assert.False(result.CancellationOutcome.RefundPending);
        Assert.Equal(40m, (await db.CancellationFinancialResolutions.SingleAsync()).FinalPropertyShare);
        Assert.Equal(40m, (await db.FinancialEntries.SingleAsync(e => e.CorrelationKey!.EndsWith(":replacement"))).Amount);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task PaidCancellationRequiresBothAuthorities(bool cancelAllowed, bool paymentsAllowed)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            Service(db, cancelAllowed: cancelAllowed, paymentsAllowed: paymentsAllowed)
                .CancelAsync(1, Auto(), Actor));
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
    }

    [Fact]
    public async Task InvalidManualAllocationRollsBackEverything()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var notifications = new RecordingNotificationService();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            Service(db, notifications).CancelAsync(1, Manual(guest: 60, property: 40, kooch: 10), Actor));
        db.ChangeTracker.Clear();
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Single(await db.FinancialEntries.ToListAsync());
        Assert.Empty(notifications.Requests);
    }

    [Fact]
    public async Task PaidRequestRequiresKeyAndAutomaticModeRejectsManualAmounts()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var missingKey = Auto(); missingKey.IdempotencyKey = null;
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).CancelAsync(1, missingKey, Actor));
        var contradictory = Auto(); contradictory.FinancialResolution = new()
        {
            Mode = CancellationFinancialResolutionMode.AutomaticFullRefundV1, GuestRefundAmount = 100
        };
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).CancelAsync(1, contradictory, Actor));
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailureAfterFinancialPostingRollsBackLedgerResolutionAndSettlementRelease(bool allocated)
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        if (allocated) await Settlements(db).CreateAsync(1, [1], allowEarlySettlement: true);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RejectCancellation BEFORE UPDATE ON Reservations
            WHEN NEW.Status = 3 BEGIN SELECT RAISE(ABORT, 'injected cancellation failure'); END;
            """);
        var notifications = new RecordingNotificationService();
        await Assert.ThrowsAnyAsync<Exception>(() => Service(db, notifications).CancelAsync(1, Auto(), Actor));
        db.ChangeTracker.Clear();
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Null((await db.Reservations.SingleAsync()).CancellationIdempotencyKey);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Single(await db.FinancialEntries.ToListAsync());
        if (allocated)
        {
            Assert.Null((await db.Settlements.SingleAsync()).CancelledAtUtc);
            Assert.Null((await db.SettlementItems.SingleAsync()).ReleasedAtUtc);
        }
        Assert.Empty(notifications.Requests);
    }

    [Fact]
    public async Task UnpaidSettlementIsReleasedInSameCancellationTransaction()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var settlement = await Settlements(db).CreateAsync(1, [1], allowEarlySettlement: true);
        await Service(db).CancelAsync(1, Auto(), Actor);
        db.ChangeTracker.Clear();
        Assert.NotNull((await db.Settlements.SingleAsync(s => s.Id == settlement.Id)).CancelledAtUtc);
        Assert.NotNull((await db.SettlementItems.SingleAsync()).ReleasedAtUtc);
        Assert.Equal(ReservationStatus.Cancelled, (await db.Reservations.SingleAsync()).Status);
    }

    [Fact]
    public async Task PaidSettlementBlocksCancellationWithZeroWrites()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1], allowEarlySettlement: true);
        await Settlements(db).MarkPaidAsync(batch.Id, new MarkSettlementPaidRequest
        {
            ReferenceNumber = "bank-1", PaidAtUtc = Now, PaymentMethod = SettlementPaymentMethod.BankTransfer
        }, 1);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).CancelAsync(1, Auto(), Actor));
        Assert.StartsWith("PostSettlementNettingRequired:", error.Message);
        db.ChangeTracker.Clear();
        Assert.Equal(ReservationStatus.Confirmed, (await db.Reservations.SingleAsync()).Status);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Single(await db.FinancialEntries.ToListAsync());
        Assert.NotNull((await db.Settlements.SingleAsync()).PaidAtUtc);
    }

    [Fact]
    public async Task PaidSettlementControllerReturnsMachineReadableConflict()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var batch = await Settlements(db).CreateAsync(1, [1], allowEarlySettlement: true);
        await Settlements(db).MarkPaidAsync(batch.Id, new MarkSettlementPaidRequest
        {
            ReferenceNumber = "bank-1", PaidAtUtc = Now, PaymentMethod = SettlementPaymentMethod.BankTransfer
        }, 1);
        var controller = new AdminReservationsController(Service(db), null!, null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.HttpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, "1"),
             new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, UserRole.SuperAdmin.ToString())], "test"));
        var response = await controller.Cancel(1, Auto(), default);
        var conflict = Assert.IsType<ConflictObjectResult>(response.Result);
        Assert.Contains("PostSettlementNettingRequired", System.Text.Json.JsonSerializer.Serialize(conflict.Value));
    }

    [Fact]
    public async Task LegacyRefundCancelsWithoutAnotherResolutionOrReversal()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        await new ReservationRefundService(db, Settlements(db), new Clock()).RecordAsync(1,
            new ReservationRefundRequest
            {
                ReferenceNumber = "legacy-bank", RefundedAt = Now,
                Reason = "legacy full refund", IdempotencyKey = "legacy-refund"
            }, 1);
        var before = await db.FinancialEntries.CountAsync();
        var service = Service(db);
        var response = await service.CancelAsync(1, Auto(), Actor);
        Assert.True(response.CancellationOutcome!.AlreadyHandledByLegacyRefundV1);
        Assert.False(response.CancellationOutcome.RefundPending);
        Assert.Empty(await db.CancellationFinancialResolutions.ToListAsync());
        Assert.Equal(before, await db.FinancialEntries.CountAsync());
        Assert.Equal("cancel-1", (await db.Reservations.SingleAsync()).CancellationIdempotencyKey);
        Assert.True((await service.CancelAsync(1, Auto(), Actor)).CancellationOutcome!.IdempotentReplay);
    }

    [Fact]
    public async Task ReplayConflictsOnChangedReasonExplanationFinancialNoteOrKey()
    {
        await using var store = await Store.CreateAsync();
        await using var db = store.Open();
        var service = Service(db);
        await service.CancelAsync(1, Manual(), Actor);
        var changed = Manual(); changed.Explanation = "different explanation";
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(1, changed, Actor));
        changed = Manual(); changed.Reason = ReservationCancellationReason.Other;
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(1, changed, Actor));
        changed = Manual(); changed.FinancialResolution!.Note = "different note";
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(1, changed, Actor));
        changed = Manual(); changed.FinancialResolution!.GuestRefundAmount = 40;
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(1, changed, Actor));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(1, Manual("other-key"), Actor));
        Assert.Equal(1, await db.CancellationFinancialResolutions.CountAsync());
    }

    [Fact]
    public async Task SameKeyCannotCancelAnotherReservationAndLegacyCancelledCannotReplay()
    {
        await using var store = await Store.CreateAsync(paid: false, secondReservation: true);
        await using var db = store.Open();
        var service = Service(db);
        await service.CancelAsync(1, Auto(), Actor);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(2, Auto(), Actor));
        var other = await db.Reservations.SingleAsync(r => r.Id == 2);
        other.Status = ReservationStatus.Cancelled;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(2, Auto("new-key"), Actor));
        Assert.Null(other.CancellationIdempotencyKey);
    }

    private static SettlementService Settlements(KoochDbContext db) => new(db, new Clock());

    private static ReservationService Service(KoochDbContext db, RecordingNotificationService? notifications = null,
        bool cancelAllowed = true, bool paymentsAllowed = true) => new(
        db, new StubReservationAvailabilityService(), new StubReservationPricingService(),
        new StubReservationNumberGenerator(), notifications ?? new RecordingNotificationService(),
        new RecordingReservationNotificationDispatcher(), new RecordingAuditLogService(),
        new Permissions(cancelAllowed, paymentsAllowed), new StubPropertyAuthorizationService(true),
        new ReservationStatusWorkflow(), new EffectiveAvailabilityService(db), new TestHostEnvironment(),
        new CancellationFinancialResolutionService(db, Settlements(db), new Clock()));

    private sealed class Permissions(bool cancel, bool payments) : IPermissionService
    {
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(cancel);
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(permissionKey != PermissionKey.ManagePayments || payments);
    }

    private sealed class Store(string path) : IAsyncDisposable
    {
        public KoochDbContext Open() => new TestContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite($"Data Source={path};Foreign Keys=False;Pooling=False").Options);

        public static async Task<Store> CreateAsync(bool paid = true, bool secondReservation = false)
        {
            var store = new Store(Path.Combine(Path.GetTempPath(), $"kooch-cancel-{Guid.NewGuid():N}.db"));
            await using var db = store.Open();
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(new User { Id = 1, FirstName = "Admin", Role = UserRole.SuperAdmin },
                new User { Id = 2, FirstName = "Guest", Role = UserRole.Client });
            db.Properties.Add(new Property { Id = 1, OwnerId = 1, Name = "Property", Slug = "property" });
            db.RoomTypes.Add(new RoomType { Id = 1, PropertyId = 1, Name = "Room", Slug = "room" });
            db.Guests.Add(new Guest { Id = 1, UserId = 2, FirstName = "Guest" });
            db.Reservations.Add(new Reservation
            {
                Id = 1, PropertyId = 1, ClientId = 2, GuestId = 1, RoomTypeId = 1,
                ReservationNumber = "R-100001", Status = ReservationStatus.Confirmed,
                CheckInDate = new DateOnly(2026, 9, 25), CheckOutDate = new DateOnly(2026, 9, 27),
                FinalAmount = 100, PaidAtUtc = paid ? Now.UtcDateTime : null
            });
            if (secondReservation) db.Reservations.Add(new Reservation
            {
                Id = 2, PropertyId = 1, ClientId = 2, GuestId = 1, RoomTypeId = 1,
                ReservationNumber = "R-100002", Status = ReservationStatus.Confirmed,
                CheckInDate = new DateOnly(2026, 9, 25), CheckOutDate = new DateOnly(2026, 9, 27)
            });
            if (paid)
            {
                db.SiteSettings.Add(new SiteSetting { Key = SettlementPolicy.OffsetDaysKey, Value = "999" });
                db.Payments.Add(new Payment { Id = 1, ReservationId = 1, Amount = 100,
                    Currency = "IRR", Status = PaymentStatus.Successful });
                db.ReservationFinancialSnapshots.Add(new ReservationFinancialSnapshot
                {
                    Id = 1, ReservationId = 1, PropertyId = 1, PaymentId = 1,
                    Currency = "IRR", GrossAmount = 100, CommissionBase = 100,
                    CommissionAmount = 12, PropertyPayableAmount = 88
                });
                db.FinancialEntries.Add(new FinancialEntry
                {
                    Id = 1, PropertyId = 1, ReservationId = 1, PaymentId = 1,
                    EntryType = FinancialEntryType.PropertyPayable, Amount = 88, Currency = "IRR",
                    PayableDueDate = new DateOnly(2026, 9, 27),
                    CorrelationKey = "payment:1:reservation:1"
                });
            }
            await db.SaveChangesAsync();
            return store;
        }

        public ValueTask DisposeAsync() { File.Delete(path); return ValueTask.CompletedTask; }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<Reservation>().Property(item => item.RowVersion).ValueGeneratedNever();
            builder.Entity<Payment>().Property(item => item.RowVersion).ValueGeneratedNever();
        }
    }
}
