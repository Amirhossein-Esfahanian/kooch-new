using System.Data.Common;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

// The opt-in fixture creates a GUID-named database and deletes only that database.
public sealed partial class AdminManualBookingSqlServerTests(SqlServerWalletDatabase database)
    : IClassFixture<SqlServerWalletDatabase>
{
    private static readonly DateOnly Arrival = new(2035, 4, 1);

    [SqlServerWalletFact]
    public async Task Availability_KnownPhysicalRoomsHaveApiFields_ClosedNightReturnsNoRooms()
    {
        var seed = await SeedAsync();
        await using var db = Open();
        var service = new ReservationAvailabilityService(db, new EffectiveAvailabilityService(db));
        var rooms = await service.GetAvailableRoomsAsync(seed.PropertyId, Arrival, Arrival.AddDays(2));
        Assert.Equal(seed.Rooms.Order(), rooms.Select(r => r.Id).Order());
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        var response = System.Text.Json.JsonSerializer.SerializeToElement(rooms, options);
        Assert.Equal(3, response.GetArrayLength());
        Assert.Equal(seed.RoomTypeId, response[0].GetProperty("roomTypeId").GetInt32());
        Assert.Equal("OnRequest", response[0].GetProperty("bookingMode").GetString());
        Assert.True(response[0].GetProperty("capacity").GetInt32() > 0);
        Assert.False(string.IsNullOrWhiteSpace(response[0].GetProperty("name").GetString()));
        var closed = await db.Availabilities.SingleAsync(a => a.RoomTypeId == seed.RoomTypeId && a.Date == Arrival);
        closed.Status = AvailabilityStatus.Unavailable; closed.AvailableCount = 0;
        await db.SaveChangesAsync();
        await using var fresh = Open();
        Assert.Empty(await new ReservationAvailabilityService(fresh, new EffectiveAvailabilityService(fresh))
            .GetAvailableRoomsAsync(seed.PropertyId, Arrival, Arrival.AddDays(2)));
    }

    [SqlServerWalletFact]
    public async Task Availability_PositiveCalendarWithoutPhysicalRooms_IsNotBookable()
    {
        var seed = await SeedAsync();
        var checkIn = new DateOnly(2026, 11, 18); // 1405/08/27; checkout is exclusive.
        var checkOut = checkIn.AddDays(1);
        await using (var setup = Open())
        {
            var type = await setup.RoomTypes.SingleAsync(t => t.Id == seed.RoomTypeId);
            type.InventoryMode = InventoryMode.NamedRooms;
            type.TotalInventory = 1;
            setup.Rooms.RemoveRange(await setup.Rooms.Where(r => r.RoomTypeId == type.Id).ToListAsync());
            setup.Availabilities.AddRange(new Availability
            {
                RoomTypeId = type.Id, Date = checkIn, AvailableCount = 1, Status = AvailabilityStatus.Available
            }, new Availability
            {
                RoomTypeId = type.Id, Date = checkOut, AvailableCount = 0,
                Status = AvailabilityStatus.Unavailable, IsClosed = true
            });
            await setup.SaveChangesAsync();
        }

        await using (var read = Open())
        {
            var effective = new EffectiveAvailabilityService(read);
            var calendar = await new AvailabilityService(read, new PropertyAccessService(read),
                    new RecordingAuditLogService(), effective)
                .GetPropertyInventoryAsync(seed.AdminId, UserRole.SuperAdmin, seed.PropertyId, checkIn, checkOut);
            var nights = Assert.Single(calendar.RoomTypes).Days;
            Assert.Equal(1, nights.Single(d => d.Date == checkIn).AvailableCount);
            Assert.Equal(AvailabilityStatus.Available, nights.Single(d => d.Date == checkIn).Status);
            Assert.Empty(await new ReservationAvailabilityService(read, effective)
                .GetAvailableRoomsAsync(seed.PropertyId, checkIn, checkOut));
        }

        int roomId;
        await using (var setup = Open())
        {
            var room = new Room { RoomTypeId = seed.RoomTypeId, Name = "Configured physical test room", IsActive = true };
            setup.Rooms.Add(room);
            await setup.SaveChangesAsync();
            roomId = room.Id;
        }
        await using (var read = Open())
        {
            var room = Assert.Single(await new ReservationAvailabilityService(read, new EffectiveAvailabilityService(read))
                .GetAvailableRoomsAsync(seed.PropertyId, checkIn, checkOut));
            Assert.Equal(roomId, room.Id); // The closed checkout day must not exclude this one-night stay.
            Assert.Equal(ReservationBookingModeFilter.Instant, room.BookingMode);
        }
        await using (var setup = Open())
        {
            (await setup.Rooms.SingleAsync(r => r.Id == roomId)).IsActive = false;
            await setup.SaveChangesAsync();
        }
        await using var finalRead = Open();
        Assert.Empty(await new ReservationAvailabilityService(finalRead, new EffectiveAvailabilityService(finalRead))
            .GetAvailableRoomsAsync(seed.PropertyId, checkIn, checkOut));
    }

    [SqlServerWalletFact]
    public async Task CreateOneRoom_ReconcilesOrderWithoutOnlineSideEffects()
    {
        var seed = await SeedAsync();
        await using var db = database.NewContext();
        var result = await Reservations(db).CreateAsync(Request(seed, 1), (seed.AdminId, UserRole.SuperAdmin));
        await using var fresh = database.NewContext();
        var session = await fresh.BookingSessions.Include(s => s.Reservations).SingleAsync(s => s.Id == result.BookingSessionId);
        Assert.Single(session.Reservations);
        Assert.Equal(200m, result.TotalAmount);
        Assert.All(session.Reservations, r =>
        {
            Assert.Equal(ReservationSource.AdminCreated, r.Source);
            Assert.Equal(ReservationStatus.PendingApproval, r.Status);
            Assert.Null(r.PaymentExpiresAtUtc);
        });
        Assert.False(await fresh.Payments.AnyAsync(p => p.BookingSessionId == session.Id));
        Assert.False(await fresh.BookingFundingAttempts.AnyAsync(p => p.BookingSessionId == session.Id));
    }

    [SqlServerWalletFact]
    public async Task ThreeRoomSettlement_ReportVoucherAndPaidCancellationRemainPerRoom()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        await using (var db = database.NewContext())
            await Payments(db).SettleOrderAsync(order, Receipt("three-rooms"), seed.AdminId);
        await AssertBalancedAsync(order, 1, 3);
        await using (var fresh = database.NewContext())
        {
            var report = await new AdminReportService(fresh, new PropertyAccessService(fresh), new StubPermissionService(true))
                .GetReservationsAsync(seed.AdminId, UserRole.SuperAdmin, new() { PropertyIds = [seed.PropertyId] });
            Assert.Equal(600m, report.Summary.CollectedAmount);
            var vouchers = await fresh.ReservationVouchers.Where(v => v.PropertyId == seed.PropertyId).ToListAsync();
            Assert.Equal(3, vouchers.Count);
            Assert.All(vouchers, v => { Assert.Equal(200m, v.GrossAmount); Assert.Equal(Arrival, v.CheckInSnapshot); });
            foreach (var voucher in vouchers)
            {
                var display = await new ReservationVoucherQueryService(fresh, new StubPermissionService(true)).GetForAdminAsync(voucher.ReservationId);
                Assert.Equal(voucher.ReservationNumberSnapshot, display.ReservationNumber);
                Assert.Equal(200m, display.GrossAmount);
                Assert.Equal(180m, display.PropertyPayableAmount);
                Assert.Equal("IRR", display.Currency);
            }
        }
        var target = seed.Rooms[0];
        int cancelledId;
        await using (var db = database.NewContext())
        {
            cancelledId = await db.Reservations.Where(r => r.BookingSessionId == order && r.RoomId == target).Select(r => r.Id).SingleAsync();
            var cancelled = await Reservations(db).CancelAsync(cancelledId, new()
            {
                Reason = ReservationCancellationReason.GuestRequest,
                Explanation = "Synthetic SQL verification", IdempotencyKey = $"cancel-{order}"
            }, (seed.AdminId, UserRole.SuperAdmin));
            Assert.Equal(ReservationStatus.Cancelled, cancelled.Status);
        }
        await using var verify = database.NewContext();
        var siblings = await verify.Reservations.Where(r => r.BookingSessionId == order && r.Id != cancelledId).ToListAsync();
        Assert.Equal(2, siblings.Count);
        Assert.All(siblings, r => Assert.Equal(ReservationStatus.Confirmed, r.Status));
        var allocations = await verify.PaymentItems.Where(i => i.Payment.BookingSessionId == order).ToListAsync();
        Assert.Equal(3, allocations.Count);
        Assert.All(allocations, a => Assert.Equal(200m, a.AllocatedAmount));
        Assert.Equal(600m, allocations.Sum(a => a.AllocatedAmount));
        var resolution = Assert.Single(await verify.CancellationFinancialResolutions.Where(r => r.ReservationId == cancelledId).ToListAsync());
        Assert.Equal(200m, resolution.GrossPaidAmount);
        Assert.Equal(200m, resolution.GuestRefundAmount);
        Assert.Equal(0m, resolution.FinalPropertyShare);
        Assert.Equal(0m, resolution.FinalKoochShare);
        Assert.Equal(CancellationFinancialResolutionMode.AutomaticFullRefundV1, resolution.Mode);
        // Cancellation records an entitlement, not an actual external cash payout.
        Assert.False(await verify.CancellationCashRefundExecutions.AnyAsync(r => r.CancellationFinancialResolutionId == resolution.Id));
        Assert.False(await verify.CancellationFinancialResolutions.AnyAsync(r => siblings.Select(s => s.Id).Contains(r.ReservationId)));
        Assert.Equal(3, await verify.ReservationVouchers.CountAsync(v => v.Reservation.BookingSessionId == order));
    }

    [SqlServerWalletFact]
    public async Task SameKey_OverlappingContextsPersistOneReceiptAndOneAllocationSet()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        var gate = new CommitGate();
        var entered = new CommandSignal();
        await using var first = Open(gate);
        await using var second = Open(entered);
        var request = Receipt("same-key");
        var left = Payments(first).SettleOrderAsync(order, request, seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var right = Payments(second).SettleOrderAsync(order, request, seed.AdminId);
        try
        {
            await entered.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(left.IsCompleted);
            Assert.False(right.IsCompleted); // second SQL command has started while first transaction is uncommitted
        }
        finally { gate.Release.TrySetResult(); }
        var results = await Task.WhenAll(left, right).WaitAsync(TimeSpan.FromSeconds(60));
        Assert.Equal(results[0].PaymentId, results[1].PaymentId);
        Assert.False(results[0].IsReplay);
        Assert.True(results[1].IsReplay);
        await AssertBalancedAsync(order, 1, 3);
    }

    [SqlServerWalletFact]
    public async Task DifferentKeys_OverlappingContextsRejectLoserWithoutPartialAllocations()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        var gate = new CommitGate();
        var signal = new CommandSignal();
        await using var first = Open(gate);
        await using var second = Open(signal);
        var left = Payments(first).SettleOrderAsync(order, Receipt("winner"), seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var right = Payments(second).SettleOrderAsync(order, Receipt("loser"), seed.AdminId);
        try
        {
            await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(left.IsCompleted); Assert.False(right.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        await left.WaitAsync(TimeSpan.FromSeconds(60));
        await Assert.ThrowsAsync<InvalidOperationException>(() => right.WaitAsync(TimeSpan.FromSeconds(60)));
        await AssertBalancedAsync(order, 1, 3);
        await using var fresh = database.NewContext();
        Assert.False(await fresh.Payments.AnyAsync(p => p.BookingSessionId == order && p.IdempotencyKey == "loser"));
    }

    [SqlServerWalletFact]
    public async Task OrderSettlementVersusIndividualApproval_OverlapCannotOverpayRoom()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        int individualId;
        await using (var db = database.NewContext())
        {
            var reservation = await db.Reservations.FirstAsync(r => r.BookingSessionId == order);
            individualId = (await Payments(db).CreateAsync(new()
            {
                ReservationId = reservation.Id, Amount = 200, Currency = "IRR", Method = ManualPaymentMethod.BankTransfer,
                PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow)
            }, seed.AdminId)).PaymentId;
        }
        var gate = new CommitGate();
        var signal = new CommandSignal();
        await using var first = Open(gate);
        await using var second = Open(signal);
        var left = Payments(first).SettleOrderAsync(order, Receipt("versus-individual"), seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var right = Payments(second).ApproveAsync(individualId, seed.AdminId);
        try
        {
            await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(left.IsCompleted); Assert.False(right.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        await left.WaitAsync(TimeSpan.FromSeconds(60));
        await Assert.ThrowsAsync<InvalidOperationException>(() => right.WaitAsync(TimeSpan.FromSeconds(60)));
        await AssertBalancedAsync(order, 1, 3);
        await using var fresh = database.NewContext();
        Assert.NotEqual(PaymentStatus.Successful, (await fresh.Payments.SingleAsync(p => p.Id == individualId)).Status);
    }

    [SqlServerWalletFact]
    public async Task IndividualApprovalFirst_OverlappingOrderSettlementRejectsStaleAmount()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        int individualId;
        await using (var setup = database.NewContext())
        {
            var room = await setup.Reservations.FirstAsync(r => r.BookingSessionId == order);
            individualId = (await Payments(setup).CreateAsync(new()
            {
                ReservationId = room.Id, Amount = 200, Currency = "IRR", Method = ManualPaymentMethod.BankTransfer,
                PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow)
            }, seed.AdminId)).PaymentId;
        }
        var gate = new CommitGate();
        var signal = new CommandSignal();
        await using var first = Open(gate);
        await using var second = Open(signal);
        var individual = Payments(first).ApproveAsync(individualId, seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var group = Payments(second).SettleOrderAsync(order, Receipt("stale-after-individual"), seed.AdminId);
        try
        {
            await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(individual.IsCompleted); Assert.False(group.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        await individual.WaitAsync(TimeSpan.FromSeconds(60));
        await Assert.ThrowsAsync<InvalidOperationException>(() => group.WaitAsync(TimeSpan.FromSeconds(60)));
        await using (var verify = database.NewContext())
        {
            Assert.False(await verify.Payments.AnyAsync(p => p.BookingSessionId == order));
            Assert.False(await verify.PaymentItems.AnyAsync(i => i.Reservation.BookingSessionId == order));
            Assert.Equal(1, await verify.Reservations.CountAsync(r => r.BookingSessionId == order && r.Status == ReservationStatus.Confirmed));
            var balance = await Payments(verify).GetOrderBalanceAsync(order, seed.AdminId);
            Assert.Equal(400m, balance.RemainingAmount);
            var freshRequest = Receipt("remaining-after-individual");
            freshRequest.ConfirmedAmount = 400;
            await Payments(verify).SettleOrderAsync(order, freshRequest, seed.AdminId);
        }
        await AssertBalancedAsync(order, 1, 2);
    }

    [SqlServerWalletFact]
    public async Task Allocation_PersistsPerRoomGuestCountsAndAuthoritativePrices()
    {
        var seed = await SeedAsync();
        await using (var db = database.NewContext())
        {
            var property = await db.Properties.FindAsync(seed.PropertyId);
            property!.ChildPrice = 50; property.FreeChildAgeLimit = 5;
            var setting = await db.SiteSettings.SingleOrDefaultAsync(s => s.Key == ChildPricingRuleResolver.HalfPriceChildMaxAgeKey);
            if (setting is null) db.SiteSettings.Add(new() { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
            else { setting.Value = "12"; setting.IsActive = true; }
            await db.SaveChangesAsync();
            var request = Request(seed, 3);
            request.Adults = 4; request.Children = 1; request.ChildAges = [8];
            var result = await Reservations(db).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin));
            Assert.Equal(700m, result.TotalAmount);
        }
        await using var fresh = database.NewContext();
        var rooms = await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).OrderBy(r => r.Id).ToListAsync();
        Assert.Equal(new[] { 2, 1, 1 }, rooms.Select(r => r.AdultCount));
        Assert.Equal(new[] { 0, 1, 0 }, rooms.Select(r => r.ChildCount));
        Assert.Equal(new[] { 200m, 300m, 200m }, rooms.Select(r => r.FinalAmount));
    }

    [SqlServerWalletFact]
    public async Task CreateFailureAfterWritesBeforeCommit_RollsBackOrderRoomsAndInventory()
    {
        var seed = await SeedAsync();
        var gate = new CommitGate(fail: true);
        await using var db = Open(gate);
        var create = Reservations(db).CreateAsync(Request(seed, 3), (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            Assert.Single(await db.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
            Assert.Equal(3, await db.Reservations.CountAsync(r => r.PropertyId == seed.PropertyId));
        }
        finally { gate.Release.TrySetResult(); }
        await Assert.ThrowsAsync<IOException>(() => create);
        await using var fresh = database.NewContext();
        Assert.False(await fresh.BookingSessions.AnyAsync(s => s.PropertyId == seed.PropertyId));
        Assert.False(await fresh.Reservations.AnyAsync(r => r.PropertyId == seed.PropertyId));
        Assert.All(await fresh.Availabilities.Where(a => a.RoomTypeId == seed.RoomTypeId).ToListAsync(), a => Assert.Equal(3, a.AvailableCount));
    }

    [SqlServerWalletFact]
    public async Task SettlementFailureAfterWritesBeforeCommit_RollsBackReceiptAllocationsAndStatuses()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        var gate = new CommitGate(fail: true);
        await using var db = Open(gate);
        var settle = Payments(db).SettleOrderAsync(order, Receipt("rollback"), seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            Assert.Single(await db.Payments.Where(p => p.BookingSessionId == order).ToListAsync());
            Assert.Equal(3, await db.PaymentItems.CountAsync(i => i.Payment.BookingSessionId == order));
            Assert.All(await db.Reservations.Where(r => r.BookingSessionId == order).ToListAsync(), r => Assert.Equal(ReservationStatus.Confirmed, r.Status));
        }
        finally { gate.Release.TrySetResult(); }
        await Assert.ThrowsAsync<IOException>(() => settle);
        await using var fresh = database.NewContext();
        Assert.False(await fresh.Payments.AnyAsync(p => p.BookingSessionId == order));
        Assert.False(await fresh.PaymentItems.AnyAsync(i => i.Reservation.BookingSessionId == order));
        Assert.False(await fresh.ReservationFinancialSnapshots.AnyAsync(s => s.Reservation.BookingSessionId == order));
        Assert.False(await fresh.ReservationVouchers.AnyAsync(v => v.Reservation.BookingSessionId == order));
        Assert.False(await fresh.FinancialEntries.AnyAsync(e => e.Reservation.BookingSessionId == order));
        Assert.All(await fresh.Reservations.Where(r => r.BookingSessionId == order).ToListAsync(), r =>
        { Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status); Assert.Null(r.PaidAtUtc); });
    }

    [SqlServerWalletFact]
    public async Task UnavailableOrForeignRoom_LeavesNoPartialOrder()
    {
        foreach (var foreign in new[] { false, true })
        {
            var seed = await SeedAsync();
            await using (var db = database.NewContext())
            {
                var room = await db.Rooms.FindAsync(seed.Rooms[2]);
                if (foreign)
                {
                    var other = await PropertyApprovalTestData.SeedAsync(db);
                    room!.RoomTypeId = other.RoomTypeId;
                }
                else db.Reservations.Add(new()
                {
                    PropertyId = seed.PropertyId, RoomTypeId = seed.RoomTypeId, RoomId = room!.Id,
                    ClientId = seed.AdminId, GuestId = seed.GuestId,
                    CheckInDate = Arrival, CheckOutDate = Arrival.AddDays(2), AdultCount = 1,
                    Status = ReservationStatus.Confirmed, Source = ReservationSource.AdminCreated,
                    FinalAmount = 200, TotalPrice = 200, BaseAmount = 200,
                    ReservationNumber = $"SQL-BLOCK-{seed.PropertyId}"
                });
                await db.SaveChangesAsync();
                if (foreign)
                    await Assert.ThrowsAsync<ArgumentException>(() => Reservations(db).CreateAsync(Request(seed, 3), (seed.AdminId, UserRole.SuperAdmin)));
                else
                    await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(db).CreateAsync(Request(seed, 3), (seed.AdminId, UserRole.SuperAdmin)));
            }
            await using var fresh = database.NewContext();
            Assert.False(await fresh.BookingSessions.AnyAsync(s => s.PropertyId == seed.PropertyId));
            Assert.Equal(foreign ? 0 : 1, await fresh.Reservations.CountAsync(r => r.PropertyId == seed.PropertyId));
            Assert.All(await fresh.Availabilities.Where(a => a.RoomTypeId == seed.RoomTypeId).ToListAsync(), a => Assert.Equal(3, a.AvailableCount));
        }
    }

    private KoochDbContext Open(params IInterceptor[] interceptors)
    {
        using var template = database.NewContext();
        var connection = template.Database.GetConnectionString()!;
        var target = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        Assert.StartsWith("KoochWalletConcurrency_", target.InitialCatalog);
        Assert.True(target.DataSource is "." or "localhost" or "(local)", "Only the explicitly isolated local SQL fixture is allowed.");
        return new(new DbContextOptionsBuilder<KoochDbContext>().UseSqlServer(connection, o => o.CommandTimeout(45))
            .AddInterceptors(interceptors).Options);
    }

    private static ReservationService Reservations(KoochDbContext db, bool canCreate = true, bool canPay = true, bool canAccess = true)
    {
        var effective = new EffectiveAvailabilityService(db);
        var children = new ChildPricingRuleResolver(db);
        return new(db, new ReservationAvailabilityService(db, effective),
            new ReservationPricingService(db, new PricingService(), children, new ReservationRulesResolver(db, children)),
            new ReservationNumberGenerator(db), new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
            new RecordingAuditLogService(), new StubPermissionService(canCreate), new StubPropertyAuthorizationService(canAccess),
            new ReservationStatusWorkflow(), effective, new TestHostEnvironment(),
            new CancellationFinancialResolutionService(db, new SettlementService(db, TimeProvider.System), TimeProvider.System),
            Payments(db, canPay, canAccess));
    }

    private static AdminManualPaymentService Payments(KoochDbContext db, bool canPay = true, bool canAccess = true) => new(db, new EffectiveAvailabilityService(db),
        new PaymentFinancializationService(db, new CommissionPolicyResolver(db)),
        new ReservationVoucherService(db, new VoucherNumberGenerator(db)), new StubPermissionService(canPay), new StubPropertyAuthorizationService(canAccess));

    private async Task<Seed> SeedAsync()
    {
        await using var db = Open();
        var ids = await PropertyApprovalTestData.SeedAsync(db);
        var type = await db.RoomTypes.FindAsync(ids.RoomTypeId);
        type!.BasePrice = 100; type.TotalInventory = 3; type.MaxAdults = 2; type.MaxChildren = 1;
        type.InventoryMode = InventoryMode.NamedRooms;
        var rooms = Enumerable.Range(1, 3).Select(i => new Room { RoomTypeId = ids.RoomTypeId, Name = $"SQL room {i}", IsActive = true }).ToArray();
        db.Rooms.AddRange(rooms);
        var guest = new Guest { FirstName = "SQL", LastName = "Synthetic", UserId = ids.OwnerId };
        db.Guests.Add(guest);
        for (var day = Arrival; day < Arrival.AddDays(2); day = day.AddDays(1))
        {
            db.Availabilities.Add(new() { RoomTypeId = ids.RoomTypeId, Date = day, AvailableCount = 3, Status = AvailabilityStatus.OnRequest });
            db.RoomDailyPrices.Add(new() { RoomTypeId = ids.RoomTypeId, Date = day, BasePrice = 100, GuestType = PricingGuestType.Iranian });
        }
        foreach (var (key, value) in new[] { ("reservation.ownerApprovalWindowMinutes", "45"), ("reservation.paymentWindowMinutes", "45"), ("ReservationCommissionPercent", "10") })
        {
            var setting = await db.SiteSettings.SingleOrDefaultAsync(s => s.Key == key);
            if (setting is null) db.SiteSettings.Add(new() { Key = key, Value = value, IsActive = true });
            else { setting.Value = value; setting.IsActive = true; }
        }
        await db.SaveChangesAsync();
        return new(ids.AdminId, ids.PropertyId, ids.RoomTypeId, guest.Id, rooms.Select(r => r.Id).ToArray());
    }

    private static ReservationCreateRequest Request(Seed s, int count) => new()
    {
        PropertyId = s.PropertyId, RoomTypeId = s.RoomTypeId, RoomId = s.Rooms[0], RoomIds = s.Rooms.Take(count).ToList(),
        GuestId = s.GuestId, CheckInDate = Arrival, CheckOutDate = Arrival.AddDays(2), Adults = count, ChildAges = []
    };

    private async Task<int> ApprovedOrderAsync(Seed seed)
    {
        await using var db = database.NewContext();
        var result = await Reservations(db).CreateAsync(Request(seed, 3), (seed.AdminId, UserRole.SuperAdmin));
        Assert.Equal(600m, result.TotalAmount);
        Assert.Equal(3, result.Reservations.Sum(r => r.Adults));
        Assert.All(result.Reservations, r => Assert.Equal(200m, r.FinalAmount));
        foreach (var room in result.Reservations) await Reservations(db).ApproveAsync(room.Id, (seed.AdminId, UserRole.SuperAdmin));
        return result.BookingSessionId;
    }

    private static ManualOrderSettlementRequest Receipt(string key) => new()
    { IdempotencyKey = key, ConfirmedAmount = 600, Currency = "IRR", Method = ManualPaymentMethod.BankTransfer, PaymentDate = new(2026, 11, 15) };

    private async Task AssertBalancedAsync(int order, int receiptCount, int allocationCount)
    {
        await using var fresh = database.NewContext();
        var receipts = await fresh.Payments.Where(p => p.BookingSessionId == order && p.Status == PaymentStatus.Successful).ToListAsync();
        Assert.Equal(receiptCount, receipts.Count);
        var items = await fresh.PaymentItems.Where(i => i.Payment.BookingSessionId == order).ToListAsync();
        Assert.Equal(allocationCount, items.Count);
        Assert.Equal(receipts.Sum(p => p.Amount), items.Sum(i => i.AllocatedAmount));
        foreach (var room in await fresh.Reservations.Where(r => r.BookingSessionId == order).ToListAsync())
        {
            var direct = await fresh.Payments.Where(p => p.ReservationId == room.Id && p.Status == PaymentStatus.Successful).SumAsync(p => (decimal?)p.Amount) ?? 0;
            var allocated = items.Where(i => i.ReservationId == room.Id).Sum(i => i.AllocatedAmount);
            Assert.Equal(room.FinalAmount, direct + allocated);
            Assert.Equal(ReservationStatus.Confirmed, room.Status);
        }
    }

    private sealed record Seed(int AdminId, int PropertyId, int RoomTypeId, int GuestId, int[] Rooms);

    private sealed class CommitGate(bool fail = false) : DbTransactionInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction,
            TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(TimeSpan.FromSeconds(45), cancellationToken);
            if (fail) throw new IOException("Injected isolated verification failure after writes, before commit.");
            return result;
        }
    }

    private sealed class CommandSignal : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("UPDLOCK", StringComparison.OrdinalIgnoreCase)) Entered.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }
}
