using System.Text.Json;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReservationPaymentSummaryTests
{
    [Theory]
    [InlineData(PaymentChannel.Online)]
    [InlineData(PaymentChannel.Manual)]
    public async Task ConfirmedDirectPayment_IsCountedOnce(PaymentChannel channel)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var row = await h.AddReservationAsync(ReservationStatus.Confirmed);
        h.DbContext.Payments.Add(Receipt(row, 100, channel, ManualPaymentVerificationStatus.Approved));
        await h.DbContext.SaveChangesAsync();
        var detail = await h.Service.GetByNumberForGuestUserAsync(3, row.ReservationNumber!);
        AssertSummary(detail, 100, 0, 0, 0);
        Assert.Equal(ReservationStatus.Confirmed, detail.Status);
    }

    [Theory]
    [InlineData(PaymentChannel.Online)]
    [InlineData(PaymentChannel.Manual)]
    public async Task SharedReceipt_UsesOnlyOwnAllocation_NotOrderAmountOrSibling(PaymentChannel channel)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var first = await h.AddReservationAsync(ReservationStatus.Confirmed);
        var second = await h.AddReservationAsync(ReservationStatus.Confirmed, roomTypeId: 21, roomId: 31);
        var session = await Group(h, first, second);
        var payment = Receipt(first, 200, channel, ManualPaymentVerificationStatus.Approved);
        payment.ReservationId = null;
        payment.BookingSessionId = session.Id;
        payment.Items.Add(new PaymentItem { ReservationId = first.Id, AllocatedAmount = 100, Currency = "IRR" });
        payment.Items.Add(new PaymentItem { ReservationId = second.Id, AllocatedAmount = 100, Currency = "IRR" });
        h.DbContext.Payments.Add(payment);
        await h.DbContext.SaveChangesAsync();
        h.DbContext.ChangeTracker.Clear();
        foreach (var row in new[] { first, second })
        {
            var detail = await h.Service.GetByIdForGuestUserAsync(3, row.Id);
            AssertSummary(detail, 100, 0, 0, 0);
            if (channel == PaymentChannel.Manual)
                Assert.Equal(100, Assert.Single(detail.GuestPaymentSummary!.ManualReceipts).Amount);
        }
    }

    [Fact]
    public async Task LegacyDirectReferenceAndAllocation_DoNotCountSamePaymentTwice()
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var row = await h.AddReservationAsync(ReservationStatus.Confirmed);
        var payment = Receipt(row, 100, PaymentChannel.Online, ManualPaymentVerificationStatus.Approved);
        payment.Items.Add(new PaymentItem { ReservationId = row.Id, AllocatedAmount = 100, Currency = "IRR" });
        h.DbContext.Payments.Add(payment);
        await h.DbContext.SaveChangesAsync();
        AssertSummary(await h.Service.GetByIdForGuestUserAsync(3, row.Id), 100, 0, 0, 0);
    }

    [Theory]
    [InlineData(ManualPaymentVerificationStatus.PendingVerification, 100)]
    [InlineData(ManualPaymentVerificationStatus.Rejected, 0)]
    public async Task UnverifiedReceipts_AreNotPaid_AndExposeOnlyGuestSafeFields(ManualPaymentVerificationStatus status, decimal pending)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var row = await h.AddReservationAsync(ReservationStatus.ApprovedAwaitingPayment, paymentExpiresAtUtc: DateTime.UtcNow.AddHours(1));
        row.GuestNote = "PRIVATE-MANUAL-BOOKING-NOTE";
        row.ApprovedByUserId = 1;
        row.ApprovedAtUtc = DateTime.UtcNow;
        var payment = Receipt(row, 100, PaymentChannel.Manual, status);
        h.DbContext.Payments.Add(payment);
        await h.DbContext.SaveChangesAsync();
        var detail = await h.Service.GetByIdForGuestUserAsync(3, row.Id);
        AssertSummary(detail, 0, pending, 100, 100);
        var receipt = Assert.Single(detail.GuestPaymentSummary!.ManualReceipts);
        Assert.Equal("…5678", receipt.Reference);
        Assert.Equal(payment.CreatedAtUtc, receipt.RegisteredAtUtc);
        Assert.Equal(status, receipt.VerificationStatus);
        Assert.Equal(status == ManualPaymentVerificationStatus.PendingVerification, receipt.HasActiveReviewProtection);
        if (receipt.HasActiveReviewProtection) Assert.Equal(row.PaymentExpiresAtUtc!.Value.AddHours(24), receipt.ReviewProtectionExpiresAtUtc);
        var json = JsonSerializer.Serialize(receipt);
        Assert.DoesNotContain("PRIVATE", json);
        Assert.DoesNotContain("12345678", json);
        Assert.DoesNotContain("Destination", json);
        Assert.DoesNotContain("VerifiedBy", json);
        Assert.DoesNotContain("Notes", json);
        Assert.Null(detail.Notes);
        Assert.Null(detail.ApprovedByUserId);
        Assert.Null(detail.ApprovedBy);
        Assert.All(detail.Timeline, entry =>
        {
            Assert.Null(entry.ActorUserId);
            Assert.Null(entry.Actor);
            Assert.Null(entry.Note);
        });
        Assert.DoesNotContain("PRIVATE", JsonSerializer.Serialize(detail));
    }

    [Theory]
    [InlineData(1, ReservationStatus.ApprovedAwaitingPayment, true)]
    [InlineData(25, ReservationStatus.PaymentExpired, false)]
    public async Task ExistingProtectionPolicy_IsReused_ExpiredReceiptStaysForFollowUp(int hoursPastDeadline, ReservationStatus expected, bool active)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var deadline = DateTime.UtcNow.AddHours(-hoursPastDeadline);
        var row = await h.AddReservationAsync(ReservationStatus.ApprovedAwaitingPayment, paymentExpiresAtUtc: deadline);
        var payment = Receipt(row, 100, PaymentChannel.Manual, ManualPaymentVerificationStatus.PendingVerification);
        h.DbContext.Payments.Add(payment);
        await h.DbContext.SaveChangesAsync();
        // Server-created before the original deadline; operator-entered date is unrelated.
        payment.CreatedAtUtc = deadline.AddMinutes(-1);
        // Seed historical server registration in this isolated fixture without the
        // production SaveChanges override stamping it with today's creation time.
        await h.DbContext.SaveChangesAsync(acceptAllChangesOnSuccess: true);
        var detail = await h.Service.GetByIdForGuestUserAsync(3, row.Id);
        Assert.Equal(expected, detail.Status);
        AssertSummary(detail, 0, 100, 100, 0);
        var receipt = Assert.Single(detail.GuestPaymentSummary!.ManualReceipts);
        Assert.Equal(active, receipt.HasActiveReviewProtection);
        Assert.Equal(deadline.AddHours(24), receipt.ReviewProtectionExpiresAtUtc);
        Assert.Equal(deadline, detail.PaymentExpiresAtUtc);
    }

    [Fact]
    public async Task OrderMembers_AreIndividuallyScoped_AndOtherGuestsCannotReadDetail()
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var own = await h.AddReservationAsync(ReservationStatus.Confirmed);
        var sibling = await h.AddReservationAsync(ReservationStatus.PendingApproval, roomTypeId: 21, roomId: 31);
        var foreign = await h.AddReservationAsync(ReservationStatus.Confirmed);
        foreign.GuestId = null;
        foreign.ClientId = 2;
        var session = await Group(h, own, sibling, foreign);
        h.DbContext.Payments.Add(Receipt(foreign, 100, PaymentChannel.Manual, ManualPaymentVerificationStatus.PendingVerification));
        await h.DbContext.SaveChangesAsync();
        var detail = await h.Service.GetByNumberForGuestUserAsync(3, own.ReservationNumber!);
        Assert.Equal(session.SessionCode, detail.GuestOrder!.OrderCode);
        Assert.False(detail.GuestOrder.IncludesAllReservations);
        Assert.Equal(new[] { own.ReservationNumber, sibling.ReservationNumber }, detail.GuestOrder.Reservations.Select(r => r.ReservationNumber));
        Assert.False(detail.GuestPaymentSummary!.CanPayOrder);
        Assert.Empty(detail.GuestPaymentSummary.ManualReceipts);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => h.Service.GetByIdForGuestUserAsync(2, own.Id));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => h.Service.GetByNumberForGuestUserAsync(3, foreign.ReservationNumber!));
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task OnlineOrder_CollectibleAmountUsesExistingOrderReadiness(bool pendingSibling, bool canPay)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var own = await h.AddReservationAsync(ReservationStatus.ApprovedAwaitingPayment, paymentExpiresAtUtc: DateTime.UtcNow.AddHours(1));
        var sibling = await h.AddReservationAsync(pendingSibling ? ReservationStatus.PendingApproval : ReservationStatus.ApprovedAwaitingPayment,
            roomTypeId: 21, roomId: 31, paymentExpiresAtUtc: own.PaymentExpiresAtUtc);
        own.Source = sibling.Source = ReservationSource.Website;
        await Group(h, own, sibling);
        var detail = await h.Service.GetByIdForGuestUserAsync(3, own.Id);
        Assert.True(detail.GuestOrder!.IncludesAllReservations);
        Assert.Equal(2, detail.GuestOrder.Reservations.Count);
        Assert.False(detail.IsPaymentEligible); // Existing individual-payment guard stays in place.
        Assert.True(detail.GuestPaymentSummary!.UsesOrderPayment);
        Assert.Equal(canPay, detail.GuestPaymentSummary.CanPayOrder);
        AssertSummary(detail, 0, 0, 100, canPay ? 100 : 0);
    }

    [Theory]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.PaymentExpired)]
    public async Task HistoricalUnpaidBalance_IsNotCollectible(ReservationStatus status)
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var row = await h.AddReservationAsync(status, paymentExpiresAtUtc: DateTime.UtcNow.AddHours(1));
        var detail = await h.Service.GetByIdForGuestUserAsync(3, row.Id);
        AssertSummary(detail, 0, 0, 100, 0);
        Assert.False(detail.IsPaymentEligible);
    }

    [Fact]
    public async Task CurrencySnapshot_IsSharedWithReceipt_AndLegacyUsesCurrentSetting()
    {
        await using var h = await ReservationTestHarness.CreateAsync();
        var legacy = await h.AddReservationAsync(ReservationStatus.Confirmed);
        var titled = new Reservation { ReservationNumber = "SNAPSHOT-TITLE", ClientId = 3, PropertyId = 10,
            RoomTypeId = 20, GuestId = 40, CheckInDate = h.CheckIn, CheckOutDate = h.CheckOut,
            Status = ReservationStatus.Confirmed, FinalAmount = 100, Currency = "IRR", CurrencyLabel = "عنوان زمان رزرو" };
        h.DbContext.Reservations.Add(titled);
        h.DbContext.SiteSettings.Add(new SiteSetting { Key = "pricing.currencyLabel", Value = "عنوان جدید", IsActive = true });
        await h.DbContext.SaveChangesAsync();
        h.DbContext.Payments.Add(Receipt(titled, 100, PaymentChannel.Manual, ManualPaymentVerificationStatus.Approved));
        await h.DbContext.SaveChangesAsync();
        var detail = await h.Service.GetByIdForGuestUserAsync(3, titled.Id);
        Assert.Equal("عنوان زمان رزرو", detail.CurrencyLabel);
        Assert.Equal(detail.CurrencyLabel, Assert.Single(detail.GuestPaymentSummary!.ManualReceipts).CurrencyLabel);
        Assert.Equal("عنوان جدید", (await h.Service.GetByIdForGuestUserAsync(3, legacy.Id)).CurrencyLabel);
    }

    private static Payment Receipt(Reservation row, decimal amount, PaymentChannel channel, ManualPaymentVerificationStatus status) => new()
    {
        ReservationId = row.Id, Amount = amount, Currency = "IRR", Channel = channel,
        Status = status == ManualPaymentVerificationStatus.Approved ? PaymentStatus.Successful : status == ManualPaymentVerificationStatus.Rejected ? PaymentStatus.Failed : PaymentStatus.Pending,
        ManualDetails = channel != PaymentChannel.Manual ? null : new ManualPaymentDetails
        {
            Method = ManualPaymentMethod.BankTransfer, VerificationStatus = status,
            ReferenceNumber = "12345678", PaymentDate = new DateOnly(2000, 1, 1),
            Notes = "PRIVATE-NOTE", DestinationBank = "PRIVATE-BANK", DestinationAccountReference = "PRIVATE-ACCOUNT", VerifiedByUserId = 1
        }
    };

    private static async Task<BookingSession> Group(ReservationTestHarness h, params Reservation[] rows)
    {
        var session = new BookingSession { SessionCode = $"O-{Guid.NewGuid():N}", ClientId = 3, PropertyId = 10, Currency = "IRR" };
        foreach (var row in rows) session.Reservations.Add(row);
        h.DbContext.BookingSessions.Add(session);
        await h.DbContext.SaveChangesAsync();
        return session;
    }

    private static void AssertSummary(ReservationResponse detail, decimal paid, decimal pending, decimal unpaid, decimal collectible)
    {
        var summary = Assert.IsType<GuestReservationPaymentSummary>(detail.GuestPaymentSummary);
        Assert.Equal(paid, summary.ConfirmedPaidAmount);
        Assert.Equal(paid, detail.PaidAmount);
        Assert.Equal(pending, summary.PendingReviewAmount);
        Assert.Equal(unpaid, summary.UnpaidAmount);
        Assert.Equal(unpaid, detail.RemainingAmount);
        Assert.Equal(collectible, summary.CollectibleAmount);
    }
}
