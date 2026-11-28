using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    [Theory]
    [InlineData(100)]
    [InlineData(300)]
    public async Task GuestDetailsReadModel_IncludesConsumedWallet_WithoutCountingGrossTwice(decimal wallet)
    {
        // The existing isolated SQLite fixture exercises real credit, hold consumption,
        // callback allocations and immutable financialization, not synthetic balances.
        using var db = new Database();
        await db.Credit(300);
        await db.Checkout(wallet);
        if (wallet < 300) Assert.Equal(PaymentCallbackApplicationState.Applied, (await db.Callback()).ApplicationState);
        db.Context.ChangeTracker.Clear();
        var service = new ReservationService(db.Context, new StubReservationAvailabilityService(),
            new StubReservationPricingService(), new StubReservationNumberGenerator(),
            new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
            new RecordingAuditLogService(), new StubPermissionService(true), new StubPropertyAuthorizationService(true),
            new ReservationStatusWorkflow(), new EffectiveAvailabilityService(db.Context), new TestHostEnvironment());
        var rows = await db.Context.Reservations.AsNoTracking().OrderBy(row => row.Id).ToArrayAsync();
        foreach (var row in rows)
        {
            var detail = await service.GetByIdForGuestUserAsync(1, row.Id);
            Assert.Equal(row.FinalAmount, detail.PaidAmount);
            Assert.Equal(row.FinalAmount, detail.GuestPaymentSummary!.ConfirmedPaidAmount);
            Assert.Equal(0, detail.GuestPaymentSummary.UnpaidAmount);
            Assert.Equal(0, detail.GuestPaymentSummary.PendingReviewAmount);
            Assert.Equal(0, detail.GuestPaymentSummary.CollectibleAmount);
            Assert.Equal(ReservationStatus.Confirmed, detail.Status);
        }
    }
}
