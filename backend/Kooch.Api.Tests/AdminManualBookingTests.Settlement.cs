using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingTests
{
    [Fact]
    public async Task FullSettlement_RecordsOneReceiptWithTraceableAllocationsAndIdempotentReplay()
    {
        await using var h = await Setup();
        var order = await ApprovedOrder(h);
        var service = Settlements(h);
        var balance = await service.GetOrderBalanceAsync(order, 1);
        Assert.True(balance.CanSettle);
        Assert.Equal(600m, balance.RemainingAmount);
        var request = SettlementRequest(600);
        var result = await service.SettleOrderAsync(order, request, 1);
        var replay = await service.SettleOrderAsync(order, request, 1);
        Assert.Equal(result.PaymentId, replay.PaymentId);
        Assert.True(replay.IsReplay);
        Assert.False(result.IsReplay);
        var receipt = Assert.Single(await h.DbContext.Payments.Include(p => p.ManualDetails).ToListAsync());
        Assert.Null(receipt.ReservationId);
        Assert.Equal(order, receipt.BookingSessionId);
        Assert.Equal(PaymentChannel.Manual, receipt.Channel);
        Assert.Equal(PaymentStatus.Successful, receipt.Status);
        Assert.Equal(ManualPaymentVerificationStatus.Approved, receipt.ManualDetails!.VerificationStatus);
        Assert.Equal(600m, receipt.Amount);
        Assert.Equal(3, result.Allocations.Count);
        Assert.All(result.Allocations, allocation => Assert.Equal(200m, allocation.Amount));
        Assert.Equal(receipt.Amount, await h.DbContext.PaymentItems.SumAsync(item => item.AllocatedAmount));
        Assert.Equal(600m, await h.DbContext.ReservationFinancialSnapshots.SumAsync(snapshot => snapshot.GrossAmount));
        var report = await new AdminReportService(h.DbContext, new PropertyAccessService(h.DbContext),
            new StubPermissionService(true)).GetReservationsAsync(1, UserRole.SuperAdmin, new());
        Assert.Equal(600m, report.Summary.CollectedAmount);
        var list = await h.Service.SearchAsync(new Kooch.Api.Dtos.Reservations.ReservationListQuery
        { PaidAmountMin = 200, RemainingAmountMax = 0, PaymentStatus = PaymentStatus.Successful }, h.SuperAdmin);
        Assert.Equal(3, list.TotalCount);
        Assert.All(list.Items, reservation =>
        {
            Assert.Equal(200, reservation.PaidAmount);
            Assert.Equal(0, reservation.RemainingAmount);
            Assert.Equal(order, reservation.BookingSessionId);
        });
        Assert.Equal(540m, await h.DbContext.FinancialEntries.Where(e => e.EntryType == FinancialEntryType.PropertyPayable).SumAsync(e => e.Amount));
        Assert.Equal(3, await h.DbContext.ReservationVouchers.CountAsync());
        Assert.All(await h.DbContext.Reservations.ToListAsync(), reservation => Assert.Equal(ReservationStatus.Confirmed, reservation.Status));
        var detail = Assert.Single(await service.GetByReservationAsync(result.Allocations[0].ReservationId));
        Assert.Equal(200m, detail.Amount); // Never display the whole receipt as this room's payment.
        Assert.Equal(receipt.Id, detail.PaymentId);
        balance = await service.GetOrderBalanceAsync(order, 1);
        Assert.Equal(0, balance.RemainingAmount);
        Assert.False(balance.CanSettle);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SettleOrderAsync(order, SettlementRequest(600), 1));
        Assert.Single(await h.DbContext.Payments.ToListAsync());
        request.Notes = "changed replay";
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SettleOrderAsync(order, request, 1));
    }

    [Fact]
    public async Task FullSettlement_SkipsAlreadyPaidRoomAndRejectsStaleConfirmedAmount()
    {
        await using var h = await Setup();
        var order = await ApprovedOrder(h);
        var service = Settlements(h);
        var first = await h.DbContext.Reservations.OrderBy(r => r.Id).FirstAsync();
        var individual = await service.CreateAsync(new AdminManualPaymentCreateRequest
        {
            ReservationId = first.Id, Amount = 200, Currency = "IRR",
            Method = ManualPaymentMethod.BankTransfer, PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow)
        }, 1);
        await service.ApproveAsync(individual.PaymentId, 1);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SettleOrderAsync(order, SettlementRequest(600), 1));
        Assert.Single(await h.DbContext.Payments.ToListAsync());
        var result = await service.SettleOrderAsync(order, SettlementRequest(400), 1);
        Assert.Equal(2, result.Allocations.Count);
        Assert.DoesNotContain(result.Allocations, allocation => allocation.ReservationId == first.Id);
        Assert.Equal(600m, await h.DbContext.Payments.SumAsync(p => p.Amount));
        Assert.Equal(600m, await h.DbContext.ReservationFinancialSnapshots.SumAsync(s => s.GrossAmount));
        Assert.Equal(2, await h.DbContext.Payments.CountAsync());
    }

    [Theory]
    [InlineData("status")]
    [InlineData("deadline")]
    [InlineData("unavailable")]
    [InlineData("permission")]
    [InlineData("scope")]
    [InlineData("online")]
    [InlineData("deleted")]
    [InlineData("role")]
    public async Task FullSettlement_InvalidChildOrActorRejectsWholeReceipt(string failure)
    {
        await using var h = await Setup();
        var order = await ApprovedOrder(h);
        var last = await h.DbContext.Reservations.OrderBy(r => r.Id).LastAsync();
        if (failure == "status") last.Status = ReservationStatus.Rejected;
        if (failure == "deadline") last.PaymentExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1);
        if (failure == "online") last.Source = ReservationSource.Website;
        if (failure == "deleted") last.IsDeleted = true;
        if (failure == "unavailable")
        {
            await h.AddReservationAsync(ReservationStatus.Confirmed, roomId: last.RoomId);
        }
        await h.DbContext.SaveChangesAsync();
        var service = Settlements(h, failure != "permission", failure != "scope");
        await Assert.ThrowsAnyAsync<Exception>(() => service.SettleOrderAsync(order, SettlementRequest(600), failure == "role" ? 3 : 1));
        Assert.Empty(await h.DbContext.Payments.ToListAsync());
        Assert.Empty(await h.DbContext.PaymentItems.ToListAsync());
        Assert.Empty(await h.DbContext.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await h.DbContext.FinancialEntries.ToListAsync());
        Assert.Empty(await h.DbContext.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public async Task FullSettlement_LegacyPartialReceiptIsNotSilentlyTurnedIntoSplitFinancialSources()
    {
        await using var h = await Setup();
        var order = await ApprovedOrder(h);
        var first = await h.DbContext.Reservations.OrderBy(reservation => reservation.Id).FirstAsync();
        h.DbContext.Payments.Add(new Payment
        {
            ReservationId = first.Id, Channel = PaymentChannel.Manual, Amount = 100, Currency = "IRR",
            Status = PaymentStatus.Successful, PaidAtUtc = DateTime.UtcNow
        });
        await h.DbContext.SaveChangesAsync();
        var service = Settlements(h);
        var balance = await service.GetOrderBalanceAsync(order, 1);
        Assert.Equal(500m, balance.RemainingAmount);
        Assert.False(balance.CanSettle);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SettleOrderAsync(order, SettlementRequest(500), 1));
        Assert.Contains("پرداخت جزئی", error.Message);
        Assert.Single(await h.DbContext.Payments.ToListAsync());
        Assert.Empty(await h.DbContext.PaymentItems.ToListAsync());
        Assert.Empty(await h.DbContext.ReservationFinancialSnapshots.ToListAsync());
    }

    [Fact]
    public void ManualReceiptListFilters_TranslateWithSqlServerProviderWithoutOpeningConnection()
    {
        using var db = new Kooch.Api.Data.KoochDbContext(
            new DbContextOptionsBuilder<Kooch.Api.Data.KoochDbContext>()
                .UseSqlServer("Server=unused.invalid;Database=QueryOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        var method = typeof(ReservationService).GetMethod("ApplyFilters",
            System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)!;
        var query = (IQueryable<Reservation>)method.Invoke(null, new object?[]
        {
            db.Reservations.AsNoTracking(), new Kooch.Api.Dtos.Reservations.ReservationListQuery
            { PaidAmountMin = 1, PaidAmountMax = 200, RemainingAmountMin = 0, RemainingAmountMax = 100, PaymentStatus = PaymentStatus.Successful },
            null, null, new[] { 10 }
        })!;
        var sql = query.ToQueryString();
        Assert.Contains("PaymentItems", sql);
        Assert.Contains("SUM", sql);
        Assert.Contains("Source", sql);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }

    private static AdminManualPaymentService Settlements(ReservationTestHarness h, bool permission = true, bool scope = true) => new(
        h.DbContext, h.EffectiveAvailability,
        new PaymentFinancializationService(h.DbContext, new CommissionPolicyResolver(h.DbContext)),
        new ReservationVoucherService(h.DbContext, new VoucherNumberGenerator(h.DbContext)),
        new StubPermissionService(permission), new StubPropertyAuthorizationService(scope));

    private static ManualOrderSettlementRequest SettlementRequest(decimal amount) => new()
    {
        IdempotencyKey = Guid.NewGuid().ToString("N"), ConfirmedAmount = amount, Currency = "IRR",
        Method = ManualPaymentMethod.BankTransfer, PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow),
        ReferenceNumber = "TEST-RECEIPT"
    };

    private static async Task<int> ApprovedOrder(ReservationTestHarness h)
    {
        var order = await h.Service.CreateAsync(Request(h, 3), h.SuperAdmin);
        foreach (var reservation in order.Reservations) await h.Service.ApproveAsync(reservation.Id, h.SuperAdmin);
        return order.BookingSessionId;
    }
}
