using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ManualBookingCurrencyLabelTests
{
    [Theory]
    [InlineData("تومان")]
    [InlineData("عنوان آزمایشی")]
    public async Task Creation_DetailsAndReceipt_KeepDisplayTitleWithoutChangingMoney(string label)
    {
        await using var harness = await ReservationTestHarness.CreateAsync(useAuthoritativePricing: true);
        var db = harness.DbContext;
        (await db.RoomTypes.SingleAsync(room => room.Id == 20)).BasePrice = 100;
        db.SiteSettings.Add(new SiteSetting { Key = "pricing.currencyLabel", Value = label, IsActive = true });
        await db.SaveChangesAsync();
        var result = await harness.Service.CreateAsync(new ReservationCreateRequest
        {
            PropertyId = 10, RoomTypeId = 20, RoomId = 30, GuestId = 40,
            CheckInDate = harness.CheckIn, CheckOutDate = harness.CheckOut, Adults = 1
        }, harness.SuperAdmin);
        var reservation = Assert.Single(result.Reservations);
        Assert.Equal(label, result.CurrencyLabel);
        Assert.Equal(label, reservation.CurrencyLabel);
        Assert.Equal("IRR", reservation.Currency);
        var amount = reservation.FinalAmount;
        (await db.SiteSettings.SingleAsync(x => x.Key == "pricing.currencyLabel")).Value = "عنوان بعدی";
        db.Payments.Add(new Payment
        {
            ReservationId = reservation.ReservationId, Channel = PaymentChannel.Manual,
            Amount = amount, Currency = "IRR", Status = PaymentStatus.Pending,
            ManualDetails = new ManualPaymentDetails
            {
                Method = ManualPaymentMethod.BankTransfer, PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow),
                SubmittedAtUtc = DateTime.UtcNow, SubmittedByUserId = 1
            }
        });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var admin = await harness.Service.GetByIdAsync(reservation.ReservationId);
        var guest = await harness.Service.GetByNumberForGuestUserAsync(3, reservation.ReservationNumber);
        var payments = new AdminManualPaymentService(db, harness.EffectiveAvailability,
            new PaymentFinancializationService(db, new CommissionPolicyResolver(db)),
            new ReservationVoucherService(db, new VoucherNumberGenerator(db)),
            new StubPermissionService(true), new StubPropertyAuthorizationService(true));
        var receipt = Assert.Single(await payments.GetByReservationAsync(reservation.ReservationId, 1));
        Assert.Equal(label, admin.CurrencyLabel);
        Assert.Equal(label, guest.CurrencyLabel);
        Assert.Equal(label, receipt.CurrencyLabel);
        Assert.Equal(amount, guest.FinalAmount);
        Assert.Equal(amount, receipt.Amount);
        Assert.Equal("IRR", receipt.Currency);
        Assert.Equal(label, (await db.BookingSessions.SingleAsync()).CurrencyLabel);
    }
}
