using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    private async Task<Seed> SeedReceivedAsync(bool namedRooms = false)
    {
        var seed = namedRooms ? await SeedAsync() : await SeedTypeBasedAsync();
        await using var db = Open();
        foreach (var night in await db.Availabilities.Where(night => night.RoomTypeId == seed.RoomTypeId).ToListAsync())
            night.Status = AvailabilityStatus.Available;
        await db.SaveChangesAsync();
        return seed;
    }

    private static ReservationCreateRequest ReceivedRequest(Seed seed, int count = 3)
    {
        var request = seed.Rooms.Length == 0 ? TypeRequest(seed, count) : Request(seed, count);
        request.RoomCount = count;
        request.ReviewedRoomAmounts = Enumerable.Repeat(200m, count).ToArray();
        request.ReceivedPayment = new ManualOrderSettlementRequest
        {
            IdempotencyKey = Guid.NewGuid().ToString("N"), ConfirmedAmount = 200m * count,
            Currency = "IRR", Method = ManualPaymentMethod.BankTransfer,
            ReferenceNumber = " synthetic-reference ", PaymentDate = new(2026, 11, 17)
        };
        return request;
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_ThreeTypeBasedUnits_OneReceiptAndConfirmedAllocations()
    {
        var seed = await SeedReceivedAsync();
        ManualBookingCreateResponse result;
        await using (var db = Open())
            result = await Reservations(db).CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin));
        Assert.Equal(600m, result.TotalAmount);
        Assert.Equal("IRR", result.Currency);
        Assert.Equal(3, result.Reservations.Count);
        Assert.All(result.Reservations, room =>
        {
            Assert.Equal(ReservationStatus.Confirmed, room.Status);
            Assert.Null(room.RoomId);
            Assert.Equal(1, room.Adults);
            Assert.Equal(200m, room.FinalAmount);
            Assert.Equal(200m, room.PaidAmount);
            Assert.Equal(0m, room.RemainingAmount);
            Assert.Null(room.PaymentExpiresAtUtc);
        });
        await AssertBalancedAsync(result.BookingSessionId, 1, 3);
        await using var fresh = Open();
        Assert.Equal(3, await fresh.ReservationVouchers.CountAsync(v => v.Reservation.BookingSessionId == result.BookingSessionId));
        Assert.Equal(3, await fresh.ReservationFinancialSnapshots.CountAsync(s => s.Reservation.BookingSessionId == result.BookingSessionId));
        var payment = await fresh.Payments.Include(p => p.ManualDetails).SingleAsync(p => p.BookingSessionId == result.BookingSessionId);
        Assert.Equal("synthetic-reference", payment.ManualDetails!.ReferenceNumber);
        Assert.Equal(ManualPaymentVerificationStatus.Approved, payment.ManualDetails.VerificationStatus);
        Assert.Equal(0, (await new Kooch.Api.Services.EffectiveAvailabilityService(fresh)
            .GetRangeAsync([seed.RoomTypeId], Arrival, Arrival.AddDays(2)))[seed.RoomTypeId].Nights[Arrival].RemainingCapacity);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_SingleNamedRoom_StillUsesOneOrderAndOneReceipt()
    {
        var seed = await SeedReceivedAsync(namedRooms: true);
        ManualBookingCreateResponse result;
        await using (var db = Open())
            result = await Reservations(db).CreateAsync(ReceivedRequest(seed, 1), (seed.AdminId, UserRole.SuperAdmin));
        Assert.Equal(seed.Rooms[0], Assert.Single(result.Reservations).RoomId);
        await AssertBalancedAsync(result.BookingSessionId, 1, 1);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_Omitted_PayLaterAvailableStillPendingWithoutReceiptOrHold()
    {
        var seed = await SeedReceivedAsync();
        ManualBookingCreateResponse result;
        await using (var db = Open())
            result = await Reservations(db).CreateAsync(TypeRequest(seed, 3), (seed.AdminId, UserRole.SuperAdmin));
        Assert.All(result.Reservations, room => Assert.Equal(ReservationStatus.Pending, room.Status));
        await using var fresh = Open();
        Assert.Empty(await fresh.Payments.Where(p => p.BookingSessionId == result.BookingSessionId).ToListAsync());
        Assert.Equal(3, (await new Kooch.Api.Services.EffectiveAvailabilityService(fresh)
            .GetRangeAsync([seed.RoomTypeId], Arrival, Arrival.AddDays(2)))[seed.RoomTypeId].Nights[Arrival].RemainingCapacity);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_MissingCreationPaymentOrPropertyPermission_RejectsWithoutWrites()
    {
        var seed = await SeedReceivedAsync();
        foreach (var (create, pay, scope) in new[] { (false, true, true), (true, false, true), (true, true, false) })
        {
            await using var db = Open();
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Reservations(db, create, pay, scope)
                .CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin)));
        }
        await AssertNoReceivedBookingAsync(seed);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_OnRequestAndMixedOrder_RejectsWithoutWrites()
    {
        var seed = await SeedTypeBasedAsync();
        await using (var db = Open())
            await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(db)
                .CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin)));
        await using (var db = Open())
        {
            var type = new RoomType { PropertyId = seed.PropertyId, Name = "Available synthetic", Slug = "available-synthetic",
                MaxAdults = 2, TotalInventory = 1, IsActive = true, InventoryMode = InventoryMode.TypeBasedInventory };
            db.RoomTypes.Add(type);
            for (var date = Arrival; date < Arrival.AddDays(2); date = date.AddDays(1))
            {
                db.Availabilities.Add(new() { RoomType = type, Date = date, AvailableCount = 1, Status = AvailabilityStatus.Available });
                db.RoomDailyPrices.Add(new() { RoomType = type, Date = date, BasePrice = 100, GuestType = PricingGuestType.Iranian });
            }
            await db.SaveChangesAsync();
            var mixed = ReceivedRequest(seed, 2);
            mixed.RoomTypeSelections = [new() { RoomTypeId = seed.RoomTypeId, Quantity = 1 }, new() { RoomTypeId = type.Id, Quantity = 1 }];
            await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(db).CreateAsync(mixed, (seed.AdminId, UserRole.SuperAdmin)));
        }
        await AssertNoReceivedBookingAsync(seed);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_StaleTotalCurrencyOrPerRoomReview_RejectsBeforePersisting()
    {
        var seed = await SeedReceivedAsync();
        foreach (var scenario in new[] { "amount", "currency", "rooms", "missing-review" })
        {
            var request = ReceivedRequest(seed);
            if (scenario == "amount") request.ReceivedPayment!.ConfirmedAmount = 500;
            if (scenario == "currency") request.ReceivedPayment!.Currency = "USD";
            if (scenario == "rooms") request.ReviewedRoomAmounts = [100, 300, 200];
            if (scenario == "missing-review") request.ReviewedRoomAmounts = null;
            await using var db = Open();
            var error = await Assert.ThrowsAsync<Kooch.Api.Services.ManualBookingReviewChangedException>(() => Reservations(db).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin)));
            Assert.Contains("قیمت یا ارز", error.Message);
        }
        // A real price edit after review must also reject, not just a malformed client amount.
        await using (var change = Open())
        {
            (await change.RoomDailyPrices.FirstAsync(p => p.RoomTypeId == seed.RoomTypeId)).BasePrice = 110;
            await change.SaveChangesAsync();
        }
        await using (var db = Open())
            await Assert.ThrowsAsync<Kooch.Api.Services.ManualBookingReviewChangedException>(() => Reservations(db).CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin)));
        await AssertNoReceivedBookingAsync(seed);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_CapacityChanged_RejectsWithoutBookingOrReceipt()
    {
        var seed = await SeedReceivedAsync();
        await using (var change = Open())
        {
            var night = await change.Availabilities.FirstAsync(a => a.RoomTypeId == seed.RoomTypeId);
            night.AvailableCount = 0;
            night.Status = AvailabilityStatus.Unavailable;
            await change.SaveChangesAsync();
        }
        await using (var db = Open())
            await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(db).CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin)));
        await AssertNoReceivedBookingAsync(seed);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_FailureAfterReceiptWritesBeforeCommit_RollsEverythingBack()
    {
        var seed = await SeedReceivedAsync();
        var gate = new CommitGate(fail: true);
        await using var db = Open(gate);
        var create = Reservations(db).CreateAsync(ReceivedRequest(seed), (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(45));
        Assert.Equal(3, db.Reservations.Local.Count(r => r.PropertyId == seed.PropertyId && r.Status == ReservationStatus.Confirmed));
        Assert.Single(db.Payments.Local);
        Assert.Equal(3, db.PaymentItems.Local.Count);
        gate.Release.SetResult();
        await Assert.ThrowsAsync<IOException>(() => create);
        await AssertNoReceivedBookingAsync(seed);
        await using var fresh = Open();
        Assert.Empty(await fresh.ReservationFinancialSnapshots.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Empty(await fresh.ReservationVouchers.Where(v => v.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Equal(3, (await new Kooch.Api.Services.EffectiveAvailabilityService(fresh)
            .GetRangeAsync([seed.RoomTypeId], Arrival, Arrival.AddDays(2)))[seed.RoomTypeId].Nights[Arrival].RemainingCapacity);
    }

    [SqlServerWalletFact]
    public async Task ReceivedPayment_ConcurrentSameSubmission_OverlapsAndPersistsOneBookingReceipt()
    {
        var seed = await SeedReceivedAsync();
        var request = ReceivedRequest(seed);
        var gate = new CommitGate();
        await using var firstDb = Open(gate);
        var first = Reservations(firstDb).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(45));
        var signal = new SubmissionLockSignal();
        await using var secondDb = Open(signal);
        var second = Reservations(secondDb).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin));
        await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        await Task.Delay(200);
        Assert.False(second.IsCompleted);
        gate.Release.SetResult();
        var results = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(45));
        Assert.Equal(results[0].BookingSessionId, results[1].BookingSessionId);
        await using (var retryDb = Open())
            Assert.Equal(results[0].BookingSessionId, (await Reservations(retryDb).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin))).BookingSessionId);
        await AssertBalancedAsync(results[0].BookingSessionId, 1, 3);
        await using var fresh = Open();
        Assert.Single(await fresh.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Equal(3, await fresh.Reservations.CountAsync(r => r.PropertyId == seed.PropertyId));
        request.ReceivedPayment!.ReferenceNumber = "changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(fresh).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin)));
    }

    private async Task AssertNoReceivedBookingAsync(Seed seed)
    {
        await using var fresh = Open();
        Assert.Empty(await fresh.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Empty(await fresh.Payments.Where(p => p.BookingSession != null && p.BookingSession.PropertyId == seed.PropertyId).ToListAsync());
    }

    private sealed class SubmissionLockSignal : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> NonQueryExecutingAsync(
            System.Data.Common.DbCommand command, Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("sp_getapplock")) Entered.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }
}
