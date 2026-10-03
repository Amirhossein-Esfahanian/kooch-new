using Kooch.Api.Dtos.Cashback;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    private static Task EnableCashback(Database db, CashbackCalculationMode mode = CashbackCalculationMode.Percentage,
        decimal cap = 100m) => new CashbackSettingsService(db.Context).UpdateGlobalAsync(
        new UpdateCashbackPolicyRequest("IRR", true, mode,
            mode == CashbackCalculationMode.Percentage ? 10m : null,
            mode == CashbackCalculationMode.FixedPerUnit ? 50m : null,
            mode == CashbackCalculationMode.FixedPerUnit ? 7m : null,
            cap, 30));

    [Fact]
    public async Task CashbackModernExternalOnlyCreatesOnePendingPerReservationUsingFullGross()
    {
        using var db = new Database();
        await EnableCashback(db);
        await db.Checkout(0);
        var callback = await db.Callback();
        Assert.Equal(PaymentCallbackApplicationState.Applied, callback.ApplicationState);

        var rows = await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).ToArrayAsync();
        Assert.Equal(2, rows.Length);
        Assert.Equal(new[] { 100m, 200m }, rows.Select(e => e.GuestPayableSnapshot));
        Assert.Equal(new[] { 100m, 200m }, rows.Select(e => e.EligibleBaseSnapshot));
        Assert.All(rows, e =>
        {
            Assert.Equal(0, e.NonWithdrawableWalletFundingSnapshot);
            Assert.Equal(CashbackEntitlementStatus.Pending, e.Status);
            Assert.Equal(CashbackPolicySource.Global, e.PolicySource);
            Assert.Null(e.GrantedWalletLotId);
            Assert.Null(e.GrantedWalletEntryId);
            Assert.Null(e.GrantedAtUtc);
            Assert.Equal(new DateTime(2036, 1, 2, 8, 30, 0, DateTimeKind.Utc), e.EligibleAtUtc);
        });
        Assert.Empty(await db.Context.WalletAccounts.ToListAsync());
        Assert.Empty(await db.Context.WalletLots.ToListAsync());
        Assert.Empty(await db.Context.WalletEntries.ToListAsync());
        Assert.Equal(new[] { 10m, 20m }, rows.Select(e => e.CashbackAmount));
        Assert.Equal(270m, await db.Context.FinancialEntries.SumAsync(e => e.Amount));
    }

    [Theory]
    [InlineData(false, 150, 100, 200)]
    [InlineData(true, 150, 50, 100)]
    [InlineData(false, 300, 100, 200)]
    [InlineData(true, 300, 0, 0)]
    public async Task CashbackUsesPerReservationFinalWalletLotWithdrawability(
        bool promotional, decimal wallet, decimal firstBase, decimal secondBase)
    {
        using var db = new Database();
        await EnableCashback(db);
        await db.Credit(wallet, promotional);
        var originalCredits = await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit);
        await db.Checkout(wallet);
        if (wallet < 300) await db.Callback();
        else Assert.Empty(await db.Context.Payments.ToListAsync());

        var rows = await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).ToArrayAsync();
        Assert.Equal((firstBase > 0 ? 1 : 0) + (secondBase > 0 ? 1 : 0), rows.Length);
        var expected = new[] { (10, firstBase), (11, secondBase) };
        foreach (var (id, eligible) in expected)
        {
            var row = rows.SingleOrDefault(e => e.ReservationId == id);
            if (eligible == 0) { Assert.Null(row); continue; }
            Assert.NotNull(row);
            Assert.Equal(eligible, row.EligibleBaseSnapshot);
            Assert.Equal(decimal.Round(eligible * .1m, 2, MidpointRounding.AwayFromZero), row.CashbackAmount);
        }
        Assert.Equal(originalCredits,
            await db.Context.WalletEntries.CountAsync(e => e.Direction == WalletEntryDirection.Credit));
    }

    [Fact]
    public async Task CashbackPropertyOverrideAndCheckoutTimeAreSnapshotted()
    {
        using var db = new Database();
        await EnableCashback(db);
        var property = await db.Context.Properties.SingleAsync();
        property.CheckOutTime = new TimeOnly(11, 15);
        await db.Context.SaveChangesAsync();
        var settings = new CashbackSettingsService(db.Context);
        await settings.UpdatePropertyAsync(1, new UpdatePropertyCashbackRequest("IRR",
            PropertyCashbackState.EnabledOverride, CashbackCalculationMode.Percentage,
            5m, null, null, 100m, 10));
        await db.Checkout(0);
        await db.Callback();
        var row = await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).FirstAsync();
        Assert.Equal(CashbackPolicySource.PropertyOverride, row.PolicySource);
        Assert.Equal(5m, row.PercentageRateSnapshot);
        Assert.Equal(5m, row.CashbackAmount);
        Assert.Equal(new DateTime(2036, 1, 2, 7, 45, 0, DateTimeKind.Utc), row.EligibleAtUtc);
        await settings.UpdatePropertyAsync(1, new UpdatePropertyCashbackRequest("IRR",
            PropertyCashbackState.Disabled, null, null, null, null, null, null));
        db.Context.ChangeTracker.Clear();
        Assert.Equal(5m, (await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).FirstAsync()).CashbackAmount);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CashbackDisabledPolicyDoesNotBlockBooking(bool propertyDisabled)
    {
        using var db = new Database();
        if (propertyDisabled)
        {
            await EnableCashback(db);
            await new CashbackSettingsService(db.Context).UpdatePropertyAsync(1,
                new UpdatePropertyCashbackRequest("IRR", PropertyCashbackState.Disabled,
                    null, null, null, null, null, null));
        }
        await db.Checkout(0);
        await db.Callback();
        Assert.Empty(await db.Context.ReservationCashbackEntitlements.ToListAsync());
        Assert.Equal(2, await db.Context.ReservationVouchers.CountAsync());
    }

    [Fact]
    public async Task CashbackFixedPerUnitUsesOnlyCompleteUnitsAndCap()
    {
        using var db = new Database();
        await EnableCashback(db, CashbackCalculationMode.FixedPerUnit, 10m);
        await db.Checkout(0);
        await db.Callback();
        var rows = await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).ToArrayAsync();
        Assert.Equal(new[] { 10m, 10m }, rows.Select(e => e.CashbackAmount));
        Assert.All(rows, e => Assert.Equal(CashbackCalculationMode.FixedPerUnit, e.CalculationMode));
    }

    [Fact]
    public async Task CashbackReplayDoesNotDuplicateEntitlements()
    {
        using var db = new Database();
        await EnableCashback(db);
        await db.Credit(150);
        await db.Checkout(150);
        await db.Callback();
        await db.Callback();
        await db.Checkout(150);
        Assert.Equal(2, await db.Context.ReservationCashbackEntitlements.CountAsync());
    }

    [Fact]
    public async Task CashbackMixedWalletLotsDeductOnlyPromotionalPortion()
    {
        using var db = new Database();
        await EnableCashback(db);
        await db.Credit(60, promotional: true);
        await db.Credit(90);
        await db.Checkout(150);
        await db.Callback();
        var rows = await db.Context.ReservationCashbackEntitlements.OrderBy(e => e.ReservationId).ToArrayAsync();
        Assert.Equal(2, rows.Length);
        Assert.Equal(60m, rows.Sum(e => e.NonWithdrawableWalletFundingSnapshot));
        Assert.Equal(240m, rows.Sum(e => e.EligibleBaseSnapshot));
        Assert.All(rows, e => Assert.Equal(e.GuestPayableSnapshot - e.NonWithdrawableWalletFundingSnapshot,
            e.EligibleBaseSnapshot));
    }

    [Fact]
    public async Task CashbackEntitlementsRollbackWithFailedWalletBookingApplication()
    {
        using var db = new Database();
        await EnableCashback(db);
        await db.Credit(150);
        await db.Checkout(150);
        db.Failure.Enabled = true;
        var callback = await db.Callback();
        Assert.Equal(PaymentCallbackApplicationState.Failed, callback.ApplicationState);
        db.Context.ChangeTracker.Clear();
        Assert.Empty(await db.Context.ReservationCashbackEntitlements.ToListAsync());
        Assert.Empty(await db.Context.ReservationFinancialSnapshots.ToListAsync());
    }

    [Fact]
    public async Task CashbackDoesNotEnterLegacyDirectPaymentPath()
    {
        using var db = new Database();
        await EnableCashback(db);
        var reservation = new Reservation
        {
            Id = 12, ClientId = 1, PropertyId = 1, RoomTypeId = 10,
            ReservationNumber = "R-100012", FinalAmount = 50m, Currency = "IRR",
            CheckInDate = new DateOnly(2037, 1, 1), CheckOutDate = new DateOnly(2037, 1, 2),
            AdultCount = 1, Status = ReservationStatus.ApprovedAwaitingPayment,
            PaymentExpiresAtUtc = DateTime.UtcNow.AddMinutes(30)
        };
        var payment = new Payment { ReservationId = 12, Amount = 50m, Currency = "IRR",
            Status = PaymentStatus.Pending };
        db.Context.Reservations.Add(reservation);
        db.Context.Payments.Add(payment);
        await db.Context.SaveChangesAsync();

        await new PaymentDomainApplicationHandler(db.Context, new LegacyCapacity()).ApplyAsync(payment);
        await db.Context.SaveChangesAsync();
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Empty(await db.Context.ReservationCashbackEntitlements.ToListAsync());
    }

    private sealed class LegacyCapacity : IEffectiveAvailabilityService
    {
        public Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(
            IReadOnlyCollection<int> roomTypeIds, DateOnly checkInDate, DateOnly checkOutDate,
            int? excludedReservationId = null, CancellationToken cancellationToken = default)
        {
            IReadOnlyDictionary<int, EffectiveRoomTypeAvailability> result = roomTypeIds.ToDictionary(id => id,
                id => new EffectiveRoomTypeAvailability
                {
                    RoomTypeId = id,
                    Nights = new Dictionary<DateOnly, EffectiveAvailabilityNight>
                    {
                        [checkInDate] = new()
                        {
                            Date = checkInDate, ConfiguredCapacity = 2, ClaimedCapacity = 0,
                            RemainingCapacity = 2,
                            ConfiguredStatus = AvailabilityStatus.Available,
                            EffectiveStatus = AvailabilityStatus.Available
                        }
                    }
                });
            return Task.FromResult(result);
        }
    }
}
