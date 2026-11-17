using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    private static ReservationService PreparationService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        var permissions = new PermissionService(db, access);
        var effective = new EffectiveAvailabilityService(db);
        var children = new ChildPricingRuleResolver(db);
        return new(db, new ReservationAvailabilityService(db, effective),
            new ReservationPricingService(db, new PricingService(), children, new ReservationRulesResolver(db, children)),
            new ReservationNumberGenerator(db), new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
            new AuditLogService(db, permissions), permissions, access, new ReservationStatusWorkflow(), effective, new TestHostEnvironment());
    }

    private async Task<int[]> PendingAvailableAsync(Seed seed, int count = 3)
    {
        await using var db = Open();
        var result = await Reservations(db).CreateAsync(seed.Rooms.Length == 0 ? TypeRequest(seed, count) : Request(seed, count),
            (seed.AdminId, UserRole.SuperAdmin));
        Assert.All(result.Reservations, room => Assert.Equal(ReservationStatus.Pending, room.Status));
        return result.Reservations.Select(room => room.Id).ToArray();
    }

    [SqlServerWalletFact]
    public async Task Preparation_ExistingPending_BecomesPayableThenIndividualPaymentConfirmsOnlyThatRoom()
    {
        var seed = await SeedReceivedAsync();
        var ids = await PendingAvailableAsync(seed);
        var actor = (seed.AdminId, UserRole.SuperAdmin);
        DateTime deadline;
        await using (var db = Open())
        {
            var service = PreparationService(db);
            var before = await service.GetByIdAsync(ids[0]);
            Assert.Contains(ReservationStatus.Confirmed, before.AllowedStatusTransitions);
            await service.ApplyAdminManualPaymentActionsAsync(before, actor);
            Assert.True(before.CanPrepareManualPayment);
            Assert.DoesNotContain(ReservationStatus.Confirmed, before.AllowedStatusTransitions);
            Assert.False(new ReservationStatusWorkflow().CanTransition(ReservationStatus.Pending, ReservationStatus.ApprovedAwaitingPayment));
            var prepared = await service.PrepareManualPaymentAsync(ids[0], actor);
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, prepared.Status);
            deadline = prepared.PaymentExpiresAtUtc!.Value;
            Assert.InRange(deadline, DateTime.UtcNow.AddMinutes(44), DateTime.UtcNow.AddMinutes(46));
            Assert.Null(prepared.PaidAtUtc);
            Assert.Null(prepared.ConfirmedAtUtc);
            Assert.Empty(await db.Payments.Where(payment => payment.BookingSessionId == prepared.BookingSessionId).ToListAsync());
        }
        await using (var fresh = Open())
        {
            var siblings = await fresh.Reservations.Where(room => ids.Skip(1).Contains(room.Id)).ToListAsync();
            Assert.All(siblings, room => { Assert.Equal(ReservationStatus.Pending, room.Status); Assert.Null(room.PaymentExpiresAtUtc); });
            var orderId = (await fresh.Reservations.SingleAsync(room => room.Id == ids[0])).BookingSessionId!.Value;
            Assert.False((await Payments(fresh).GetOrderBalanceAsync(orderId, seed.AdminId)).CanSettle);
            var payment = await Payments(fresh).CreateAsync(new()
            {
                ReservationId = ids[0], Amount = 200, Currency = "IRR", Method = ManualPaymentMethod.BankTransfer,
                PaymentDate = new(2026, 11, 17)
            }, seed.AdminId);
            await Payments(fresh).ApproveAsync(payment.PaymentId, seed.AdminId);
        }
        await using (var fresh = Open())
        {
            var room = await fresh.Reservations.SingleAsync(row => row.Id == ids[0]);
            Assert.Equal(ReservationStatus.Confirmed, room.Status);
            Assert.Equal(deadline, room.PaymentExpiresAtUtc);
            Assert.NotNull(room.PaidAtUtc);
            Assert.Single(await fresh.ReservationVouchers.Where(voucher => voucher.ReservationId == ids[0]).ToListAsync());
            Assert.All(await fresh.Reservations.Where(row => ids.Skip(1).Contains(row.Id)).ToListAsync(), sibling =>
                Assert.Equal(ReservationStatus.Pending, sibling.Status));
        }
    }

    [SqlServerWalletFact]
    public async Task Preparation_LegacyStandaloneNamedManualReservation_RemainsSupported()
    {
        var seed = await SeedReceivedAsync(namedRooms: true);
        var id = (await PendingAvailableAsync(seed, 1))[0];
        await using (var setup = Open())
        {
            (await setup.Reservations.SingleAsync(room => room.Id == id)).BookingSessionId = null;
            await setup.SaveChangesAsync();
        }
        await using var db = Open();
        var response = await PreparationService(db).PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin));
        Assert.Null(response.BookingSessionId);
        Assert.Equal(seed.Rooms[0], response.RoomId);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, response.Status);
        Assert.NotNull(response.PaymentExpiresAtUtc);
        Assert.Equal(ReservationSource.AdminCreated, response.Source);
    }

    [SqlServerWalletFact]
    public async Task Preparation_NoCapacity_LeavesStatusDeadlineAndFinancialStateUntouched()
    {
        var seed = await SeedReceivedAsync();
        var ids = await PendingAvailableAsync(seed, 2);
        await using (var setup = Open())
        {
            foreach (var night in await setup.Availabilities.Where(row => row.RoomTypeId == seed.RoomTypeId).ToListAsync())
                night.AvailableCount = 1;
            await setup.SaveChangesAsync();
            await PreparationService(setup).PrepareManualPaymentAsync(ids[0], (seed.AdminId, UserRole.SuperAdmin));
        }
        await using (var db = Open())
        {
            var service = PreparationService(db);
            var details = await service.GetByIdAsync(ids[1]);
            await service.ApplyAdminManualPaymentActionsAsync(details, (seed.AdminId, UserRole.SuperAdmin));
            Assert.False(details.CanPrepareManualPayment);
            var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => service.PrepareManualPaymentAsync(ids[1], (seed.AdminId, UserRole.SuperAdmin)));
            Assert.Contains("capacity", failure.Message, StringComparison.OrdinalIgnoreCase);
        }
        await AssertStillPendingAsync(ids[1]);
    }

    [SqlServerWalletFact]
    public async Task Preparation_ConcurrentRetriesWithStaleTrackedRow_KeepOneDeadlineHoldAndAudit()
    {
        var seed = await SeedReceivedAsync();
        var id = (await PendingAvailableAsync(seed, 1))[0];
        var gate = new CommitGate();
        var signal = new CommandSignal();
        await using var firstDb = Open(gate);
        await using var secondDb = Open(signal);
        await secondDb.Reservations.SingleAsync(row => row.Id == id);
        var first = PreparationService(firstDb).PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(45));
        var second = PreparationService(secondDb).PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin));
        await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        await Task.Delay(200);
        Assert.False(second.IsCompleted);
        gate.Release.SetResult();
        var replies = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(45));
        Assert.Equal(replies[0].PaymentExpiresAtUtc, replies[1].PaymentExpiresAtUtc);
        await using var fresh = Open();
        (await fresh.SiteSettings.SingleAsync(setting => setting.Key == "reservation.paymentWindowMinutes")).Value = "90";
        await fresh.SaveChangesAsync();
        var repeated = await PreparationService(fresh).PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin));
        Assert.Equal(replies[0].PaymentExpiresAtUtc, repeated.PaymentExpiresAtUtc);
        Assert.Single(await fresh.ReservationActivities.Where(activity => activity.ReservationId == id && activity.ActivityType == "PaymentPrepared").ToListAsync());
        Assert.Single(await fresh.AuditLogs.Where(log => log.EntityId == id && log.EntityType == nameof(Reservation) && log.Action == AuditAction.BookingApproved).ToListAsync());
        Assert.Empty(await fresh.Payments.Where(payment => payment.ReservationId == id).ToListAsync());
        Assert.Equal(2, (await new EffectiveAvailabilityService(fresh).GetRangeAsync([seed.RoomTypeId], Arrival, Arrival.AddDays(2)))
            [seed.RoomTypeId].Nights[Arrival].RemainingCapacity);
    }

    [SqlServerWalletFact]
    public async Task Preparation_ConcurrentDifferentReservations_LastCapacityHasOneWinner()
    {
        var seed = await SeedReceivedAsync();
        var ids = await PendingAvailableAsync(seed, 2);
        await using (var setup = Open())
        {
            foreach (var night in await setup.Availabilities.Where(row => row.RoomTypeId == seed.RoomTypeId).ToListAsync()) night.AvailableCount = 1;
            await setup.SaveChangesAsync();
        }
        var gate = new CommitGate();
        var signal = new CommandSignal();
        await using var firstDb = Open(gate);
        await using var secondDb = Open(signal);
        var first = PreparationService(firstDb).PrepareManualPaymentAsync(ids[0], (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(45));
        var second = PreparationService(secondDb).PrepareManualPaymentAsync(ids[1], (seed.AdminId, UserRole.SuperAdmin));
        await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        await Task.Delay(200);
        Assert.False(second.IsCompleted);
        gate.Release.SetResult();
        await first;
        await Assert.ThrowsAsync<InvalidOperationException>(() => second);
        await AssertStillPendingAsync(ids[1]);
    }

    [SqlServerWalletFact]
    public async Task Preparation_RealAuthorization_RejectsGuestMissingPermissionAndOtherProperty()
    {
        var seed = await SeedReceivedAsync();
        var own = (await PendingAvailableAsync(seed, 1))[0];
        var other = await SeedReceivedAsync();
        var outside = (await PendingAvailableAsync(other, 1))[0];
        await using (var db = Open())
        {
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PreparationService(db).PrepareManualPaymentAsync(own, (seed.AdminId, UserRole.Client)));
            var actorId = (await db.Properties.SingleAsync(property => property.Id == seed.PropertyId)).OwnerId;
            (await db.Users.SingleAsync(user => user.Id == actorId)).Role = UserRole.AdminAssistant;
            await db.SaveChangesAsync();
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PreparationService(db).PrepareManualPaymentAsync(own, (actorId, UserRole.AdminAssistant)));
            if (!await db.Permissions.AnyAsync(permission => permission.Key == PermissionKey.ManageReservations))
                db.Permissions.Add(new() { Key = PermissionKey.ManageReservations, Name = "Synthetic reservations" });
            db.UserPermissions.Add(new() { UserId = actorId, PermissionKey = PermissionKey.ManageReservations, IsAllowed = true });
            await db.SaveChangesAsync();
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PreparationService(db).PrepareManualPaymentAsync(outside, (actorId, UserRole.AdminAssistant)));
            await PreparationService(db).PrepareManualPaymentAsync(own, (actorId, UserRole.AdminAssistant));
        }
        await AssertStillPendingAsync(outside);
    }

    [SqlServerWalletFact]
    public async Task Preparation_OnlineOrChangedOnRequestNight_IsRejectedWithoutChangingPending()
    {
        foreach (var online in new[] { true, false })
        {
            var seed = await SeedReceivedAsync();
            var id = (await PendingAvailableAsync(seed, 1))[0];
            await using (var change = Open())
            {
                if (online) (await change.Reservations.SingleAsync(row => row.Id == id)).Source = ReservationSource.Website;
                else (await change.Availabilities.FirstAsync(row => row.RoomTypeId == seed.RoomTypeId)).Status = AvailabilityStatus.OnRequest;
                await change.SaveChangesAsync();
            }
            await using (var db = Open())
            {
                var service = PreparationService(db);
                var details = await service.GetByIdAsync(id);
                await service.ApplyAdminManualPaymentActionsAsync(details, (seed.AdminId, UserRole.SuperAdmin));
                Assert.False(details.CanPrepareManualPayment);
                await Assert.ThrowsAsync<InvalidOperationException>(() => service.PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin)));
            }
            await AssertStillPendingAsync(id);
        }
    }

    [SqlServerWalletFact]
    public async Task Preparation_MixedOrder_AvailableRoomIsIndependentAndOnRequestKeepsApprovalFlow()
    {
        var seed = await SeedReceivedAsync();
        int availableId, onRequestId, orderId;
        await using (var db = Open())
        {
            var type = new RoomType { PropertyId = seed.PropertyId, Name = "OnRequest synthetic", Slug = "onrequest-synthetic",
                MaxAdults = 2, TotalInventory = 1, IsActive = true, InventoryMode = InventoryMode.TypeBasedInventory };
            db.RoomTypes.Add(type);
            for (var date = Arrival; date < Arrival.AddDays(2); date = date.AddDays(1))
            {
                db.Availabilities.Add(new() { RoomType = type, Date = date, AvailableCount = 1, Status = AvailabilityStatus.OnRequest });
                db.RoomDailyPrices.Add(new() { RoomType = type, Date = date, BasePrice = 100, GuestType = PricingGuestType.Iranian });
            }
            await db.SaveChangesAsync();
            var request = TypeRequest(seed, 2);
            request.RoomTypeSelections = [new() { RoomTypeId = seed.RoomTypeId, Quantity = 1 }, new() { RoomTypeId = type.Id, Quantity = 1 }];
            var order = await Reservations(db).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin));
            availableId = order.Reservations.Single(room => room.RoomTypeId == seed.RoomTypeId).Id;
            onRequestId = order.Reservations.Single(room => room.RoomTypeId == type.Id).Id;
            orderId = order.BookingSessionId;
        }
        await using (var db = Open())
        {
            var service = PreparationService(db);
            await service.PrepareManualPaymentAsync(availableId, (seed.AdminId, UserRole.SuperAdmin));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.PrepareManualPaymentAsync(onRequestId, (seed.AdminId, UserRole.SuperAdmin)));
            var pending = await db.Reservations.SingleAsync(row => row.Id == onRequestId);
            Assert.Equal(ReservationStatus.PendingApproval, pending.Status);
            Assert.Null(pending.PaymentExpiresAtUtc);
            Assert.False((await Payments(db).GetOrderBalanceAsync(orderId, seed.AdminId)).CanSettle);
            await Reservations(db).ApproveAsync(onRequestId, (seed.AdminId, UserRole.SuperAdmin));
            Assert.True((await Payments(db).GetOrderBalanceAsync(orderId, seed.AdminId)).CanSettle);
        }
    }

    [SqlServerWalletFact]
    public async Task Preparation_FailureAfterWriteBeforeCommit_RollsBackStatusDeadlineHoldAndAudit()
    {
        var seed = await SeedReceivedAsync();
        var id = (await PendingAvailableAsync(seed, 1))[0];
        var gate = new CommitGate(fail: true);
        await using (var db = Open(gate))
        {
            var prepare = PreparationService(db).PrepareManualPaymentAsync(id, (seed.AdminId, UserRole.SuperAdmin));
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            try
            {
                var written = await db.Reservations.AsNoTracking().SingleAsync(row => row.Id == id);
                Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, written.Status);
                Assert.NotNull(written.PaymentExpiresAtUtc);
                Assert.True(await db.AuditLogs.AnyAsync(log => log.EntityId == id && log.EntityType == nameof(Reservation)));
            }
            finally { gate.Release.TrySetResult(); }
            await Assert.ThrowsAsync<IOException>(() => prepare);
        }
        await AssertStillPendingAsync(id);
        await using var fresh = Open();
        Assert.False(await fresh.AuditLogs.AnyAsync(log => log.EntityId == id && log.EntityType == nameof(Reservation) && log.Action == AuditAction.BookingApproved));
        Assert.False(await fresh.Payments.AnyAsync(payment => payment.ReservationId == id));
        Assert.Equal(3, (await new EffectiveAvailabilityService(fresh).GetRangeAsync([seed.RoomTypeId], Arrival, Arrival.AddDays(2)))
            [seed.RoomTypeId].Nights[Arrival].RemainingCapacity);
    }

    private async Task AssertStillPendingAsync(int id)
    {
        await using var fresh = Open();
        var unchanged = await fresh.Reservations.SingleAsync(row => row.Id == id);
        Assert.Equal(ReservationStatus.Pending, unchanged.Status);
        Assert.Null(unchanged.PaymentExpiresAtUtc);
        Assert.Null(unchanged.ApprovedAtUtc);
        Assert.False(await fresh.ReservationActivities.AnyAsync(activity => activity.ReservationId == id && activity.ActivityType == "PaymentPrepared"));
    }
}
