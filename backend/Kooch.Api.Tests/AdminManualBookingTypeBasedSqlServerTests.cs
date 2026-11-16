using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    private async Task<Seed> SeedTypeBasedAsync()
    {
        await using var db = Open();
        var ids = await PropertyApprovalTestData.SeedAsync(db);
        var type = await db.RoomTypes.SingleAsync(t => t.Id == ids.RoomTypeId);
        type.InventoryMode = InventoryMode.TypeBasedInventory;
        type.TotalInventory = 3;
        type.BasePrice = null;
        type.MaxChildren = 1;
        var guest = new Guest { FirstName = "Isolated", LastName = "Guest", UserId = ids.OwnerId };
        db.Guests.Add(guest);
        for (var date = Arrival; date < Arrival.AddDays(2); date = date.AddDays(1))
        {
            db.Availabilities.Add(new() { RoomTypeId = type.Id, Date = date, AvailableCount = 3, Status = AvailabilityStatus.OnRequest });
            db.RoomDailyPrices.Add(new() { RoomTypeId = type.Id, Date = date, BasePrice = 100, GuestType = PricingGuestType.Iranian });
        }
        await db.SaveChangesAsync();
        return new(ids.AdminId, ids.PropertyId, type.Id, guest.Id, []);
    }

    private static ReservationCreateRequest TypeRequest(Seed seed, int count) => new()
    {
        PropertyId = seed.PropertyId, GuestId = seed.GuestId, Adults = count, ChildAges = [],
        CheckInDate = Arrival, CheckOutDate = Arrival.AddDays(2), RoomCount = count,
        RoomTypeSelections = [new() { RoomTypeId = seed.RoomTypeId, Quantity = count }]
    };

    private static ReservationPricingService Pricing(Kooch.Api.Data.KoochDbContext db)
    {
        var children = new ChildPricingRuleResolver(db);
        return new(db, new PricingService(), children, new ReservationRulesResolver(db, children));
    }

    [SqlServerWalletFact]
    public async Task TypeBased_NoPhysicalRooms_AvailableCreatesThreeUnitsAndSettlesIndependently()
    {
        var seed = await SeedTypeBasedAsync();
        int orderId;
        await using (var db = Open())
        {
            var options = await new ManualBookingAvailabilityService(db, new EffectiveAvailabilityService(db), Pricing(db))
                .GetAsync(seed.PropertyId, Arrival, Arrival.AddDays(2), PricingGuestType.Iranian);
            Assert.Equal(3, Assert.Single(options.Options).AvailableCount);
            Assert.Empty(options.Options[0].Rooms);
            Assert.Empty(await db.Rooms.Where(r => r.RoomTypeId == seed.RoomTypeId).ToListAsync());
            var request = TypeRequest(seed, 3);
            request.Adults = 4;
            var validation = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
            Assert.True(System.ComponentModel.DataAnnotations.Validator.TryValidateObject(request,
                new System.ComponentModel.DataAnnotations.ValidationContext(request), validation, validateAllProperties: true));
            var order = await Reservations(db).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin));
            orderId = order.BookingSessionId;
            Assert.Equal(600m, order.TotalAmount);
            Assert.Equal(new[] { 2, 1, 1 }, order.Reservations.Select(r => r.Adults));
            foreach (var reservation in order.Reservations)
                await Reservations(db).ApproveAsync(reservation.Id, (seed.AdminId, UserRole.SuperAdmin));
        }
        await using (var fresh = Open())
        {
            var session = await fresh.BookingSessions.Include(s => s.Reservations).SingleAsync(s => s.Id == orderId);
            Assert.Equal(3, session.Reservations.Count);
            Assert.All(session.Reservations, r => { Assert.Null(r.RoomId); Assert.Equal(seed.RoomTypeId, r.RoomTypeId);
                Assert.Equal(200m, r.FinalAmount); Assert.Equal(ReservationSource.AdminCreated, r.Source); });
            Assert.Equal(600m, session.Reservations.Sum(r => r.FinalAmount));
            await Payments(fresh).SettleOrderAsync(orderId, Receipt($"pooled-{orderId}"), seed.AdminId);
        }
        await AssertBalancedAsync(orderId, 1, 3);
    }

    [SqlServerWalletFact]
    public async Task TypeBased_SoldOutOrExcessQuantity_CreatesNoPartialGraph()
    {
        var seed = await SeedTypeBasedAsync();
        foreach (var count in new[] { 4, 1 })
        {
            if (count == 1)
            {
                await using var setup = Open();
                var night = await setup.Availabilities.SingleAsync(a => a.RoomTypeId == seed.RoomTypeId && a.Date == Arrival);
                night.AvailableCount = 0;
                await setup.SaveChangesAsync();
            }
            await using (var db = Open())
                await Assert.ThrowsAsync<InvalidOperationException>(() => Reservations(db).CreateAsync(TypeRequest(seed, count), (seed.AdminId, UserRole.SuperAdmin)));
            await using var fresh = Open();
            Assert.Empty(await fresh.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
            Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
            Assert.Equal(count == 4 ? 3 : 0, (await fresh.Availabilities.SingleAsync(a => a.RoomTypeId == seed.RoomTypeId && a.Date == Arrival)).AvailableCount);
        }
    }

    [SqlServerWalletFact]
    public async Task TypeBased_MissingOccupiedPrice_BlocksOptionsPreviewAndCreate_ButNotCheckoutDate()
    {
        var seed = await SeedTypeBasedAsync();
        await using (var setup = Open())
        {
            setup.RoomDailyPrices.Remove(await setup.RoomDailyPrices.SingleAsync(p => p.RoomTypeId == seed.RoomTypeId && p.Date == Arrival.AddDays(1)));
            await setup.SaveChangesAsync();
        }
        await using (var db = Open())
        {
            var options = await new ManualBookingAvailabilityService(db, new EffectiveAvailabilityService(db), Pricing(db))
                .GetAsync(seed.PropertyId, Arrival, Arrival.AddDays(2), PricingGuestType.Iranian);
            Assert.Empty(options.Options);
            var excluded = Assert.Single(options.Excluded);
            Assert.Equal(ManualBookingExclusionReason.MissingNightlyPricing, excluded.Reason);
            Assert.Equal(new[] { Arrival.AddDays(1) }, excluded.MissingDates);
            var preview = new ReservationPricePreviewRequest { PropertyId = seed.PropertyId, RoomTypeId = seed.RoomTypeId,
                CheckInDate = Arrival, CheckOutDate = Arrival.AddDays(2), Adults = 1, RoomCount = 1, ChildAges = [], ForManualCreation = true };
            await Assert.ThrowsAsync<IncompleteDailyPricingException>(() => Reservations(db).PreviewManualBookingPriceAsync(preview));
            await Assert.ThrowsAsync<IncompleteDailyPricingException>(() => Reservations(db).CreateAsync(TypeRequest(seed, 1), (seed.AdminId, UserRole.SuperAdmin)));
            preview.CheckOutDate = Arrival.AddDays(1);
            Assert.Equal(100m, (await Reservations(db).PreviewManualBookingPriceAsync(preview)).FinalAmount);
        }
        await using var fresh = Open();
        Assert.Empty(await fresh.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
    }

    [SqlServerWalletFact]
    public async Task TypeBased_MixedEligibility_FallbackAndDiscountAreNotMissingPrices()
    {
        var seed = await SeedTypeBasedAsync();
        int missingId;
        await using (var setup = Open())
        {
            var missing = new RoomType { PropertyId = seed.PropertyId, Name = "Missing rate", Slug = "missing-rate",
                MaxAdults = 2, TotalInventory = 1, IsActive = true, InventoryMode = InventoryMode.TypeBasedInventory };
            setup.RoomTypes.Add(missing);
            (await setup.RoomTypes.SingleAsync(t => t.Id == seed.RoomTypeId)).BasePrice = 100;
            setup.RoomDailyPrices.Remove(await setup.RoomDailyPrices.SingleAsync(p => p.RoomTypeId == seed.RoomTypeId && p.Date == Arrival.AddDays(1)));
            setup.Promotions.Add(new Promotion { PropertyId = seed.PropertyId, Title = "Valid free stay", Type = PromotionType.PercentageDiscount,
                Percentage = 100, StartDate = Arrival, EndDate = Arrival.AddDays(2), IsActive = true, Weekdays = PromotionWeekday.All,
                PromotionRoomTypes = [new() { RoomTypeId = seed.RoomTypeId }] });
            await setup.SaveChangesAsync();
            missingId = missing.Id;
        }
        await using var db = Open();
        var result = await new ManualBookingAvailabilityService(db, new EffectiveAvailabilityService(db), Pricing(db))
            .GetAsync(seed.PropertyId, Arrival, Arrival.AddDays(2), PricingGuestType.Iranian);
        Assert.Equal(seed.RoomTypeId, Assert.Single(result.Options).RoomTypeId);
        var excluded = Assert.Single(result.Excluded);
        Assert.Equal(missingId, excluded.RoomTypeId);
        Assert.Equal(ManualBookingExclusionReason.MissingNightlyPricing, excluded.Reason);
        Assert.Equal(new[] { Arrival, Arrival.AddDays(1) }, excluded.MissingDates);
        var invalidOrder = TypeRequest(seed, 1);
        invalidOrder.Adults = 2;
        invalidOrder.RoomTypeSelections = [new() { RoomTypeId = seed.RoomTypeId, Quantity = 1 }, new() { RoomTypeId = missingId, Quantity = 1 }];
        await Assert.ThrowsAsync<IncompleteDailyPricingException>(() => Reservations(db).CreateAsync(invalidOrder, (seed.AdminId, UserRole.SuperAdmin)));
        await using (var fresh = Open())
            Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
        var order = await Reservations(db).CreateAsync(TypeRequest(seed, 1), (seed.AdminId, UserRole.SuperAdmin));
        Assert.Equal(0m, order.TotalAmount);
        Assert.Single(order.Reservations);
        Assert.Null(order.Reservations[0].RoomId);
    }

    [SqlServerWalletFact]
    public async Task TypeBased_FailureAfterWritesBeforeCommit_RollsBackEveryUnit()
    {
        var seed = await SeedTypeBasedAsync();
        var gate = new CommitGate(fail: true);
        await using var db = Open(gate);
        var create = Reservations(db).CreateAsync(TypeRequest(seed, 3), (seed.AdminId, UserRole.SuperAdmin));
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            Assert.Equal(3, await db.Reservations.CountAsync(r => r.PropertyId == seed.PropertyId));
        }
        finally { gate.Release.TrySetResult(); }
        await Assert.ThrowsAsync<IOException>(() => create);
        await using var fresh = Open();
        Assert.Empty(await fresh.BookingSessions.Where(s => s.PropertyId == seed.PropertyId).ToListAsync());
        Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
        Assert.All(await fresh.Availabilities.Where(a => a.RoomTypeId == seed.RoomTypeId).ToListAsync(), a => Assert.Equal(3, a.AvailableCount));
    }

    [SqlServerWalletFact]
    public async Task TypeBased_ServerRejectsForeignModeAndPropertySelections()
    {
        var seed = await SeedTypeBasedAsync();
        var foreign = await SeedTypeBasedAsync();
        await using var db = Open();
        var request = TypeRequest(seed, 1);
        request.RoomTypeSelections[0].RoomTypeId = foreign.RoomTypeId;
        await Assert.ThrowsAsync<ArgumentException>(() => Reservations(db).CreateAsync(request, (seed.AdminId, UserRole.SuperAdmin)));
        var type = await db.RoomTypes.SingleAsync(t => t.Id == seed.RoomTypeId);
        type.InventoryMode = InventoryMode.NamedRooms;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => Reservations(db).CreateAsync(TypeRequest(seed, 1), (seed.AdminId, UserRole.SuperAdmin)));
        await using var fresh = Open();
        Assert.Empty(await fresh.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync());
    }

    [SqlServerWalletFact]
    public async Task NamedRooms_OptionsRequireEligiblePhysicalUnits_AndReportSetupLimitation()
    {
        var seed = await SeedAsync();
        await using (var setup = Open())
        {
            foreach (var room in await setup.Rooms.Where(r => r.RoomTypeId == seed.RoomTypeId).ToListAsync()) room.IsActive = false;
            await setup.SaveChangesAsync();
        }
        await using (var read = Open())
        {
            var response = await new ManualBookingAvailabilityService(read, new EffectiveAvailabilityService(read), Pricing(read))
                .GetAsync(seed.PropertyId, Arrival, Arrival.AddDays(2), PricingGuestType.Iranian);
            Assert.Empty(response.Options);
            Assert.Equal(ManualBookingExclusionReason.NoEligibleNamedRooms, Assert.Single(response.Excluded).Reason);
        }
        await using (var setup = Open())
        {
            (await setup.Rooms.SingleAsync(r => r.Id == seed.Rooms[0])).IsActive = true;
            await setup.SaveChangesAsync();
        }
        await using var db = Open();
        var result = await new ManualBookingAvailabilityService(db, new EffectiveAvailabilityService(db), Pricing(db))
            .GetAsync(seed.PropertyId, Arrival, Arrival.AddDays(2), PricingGuestType.Iranian);
        var option = Assert.Single(result.Options);
        Assert.Equal(InventoryMode.NamedRooms, option.InventoryMode);
        Assert.Equal(1, option.AvailableCount);
        Assert.Equal(seed.Rooms[0], Assert.Single(option.Rooms).Id);
    }
}
