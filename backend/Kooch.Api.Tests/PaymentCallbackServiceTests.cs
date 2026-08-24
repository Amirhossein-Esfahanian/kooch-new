using Kooch.Api.Data;
using Kooch.Api.Authentication;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PaymentCallbackServiceTests
{
    [Fact]
    public async Task ValidCallback_IsValidatedAndAtomicallyConfirmsSessionReservations()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.False(result.IsDuplicate);
        Assert.Equal(PaymentCallbackApplicationState.Applied, result.ApplicationState);
        var receipt = await harness.Context.PaymentCallbackReceipts.SingleAsync();
        var payment = await harness.Context.Payments.SingleAsync(payment => payment.Id == 100);
        Assert.Equal(payment.Id, receipt.PaymentId);
        Assert.True(receipt.IsSuccessful);
        Assert.Equal("transaction-1", payment.TransactionReference);
        Assert.NotNull(payment.ProviderConfirmedAtUtc);
        Assert.NotNull(payment.AppliedAtUtc);
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(
                ReservationStatus.Confirmed,
                reservation.Status));
        Assert.Equal(2, await harness.Context.AuditLogs.CountAsync());
        Assert.Equal(2, await harness.Context.NotificationLogs.CountAsync());
    }

    [Fact]
    public async Task MixedPayment_ConfirmsIncludedChildAndPreservesRejectedChild()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, ReservationStatus.Rejected);
        var rejected = (await harness.Context.Reservations.FindAsync(11))!;
        rejected.CancellationNote = "Owner rejected this reservation.";
        rejected.ApprovalExpiresAtUtc = DateTime.UtcNow.AddMinutes(-10);
        var rejectedPaymentDeadline = rejected.PaymentExpiresAtUtc;
        var rejectedApprovalDeadline = rejected.ApprovalExpiresAtUtc;
        harness.Context.AuditLogs.Add(new AuditLog
        {
            UserId = 1,
            PropertyId = 1,
            Action = AuditAction.BookingCancelled,
            EntityType = nameof(Reservation),
            EntityId = 11,
            EntityName = rejected.ReservationNumber,
            Description = "Existing rejection audit.",
            OccurredAtUtc = DateTime.UtcNow.AddMinutes(-5)
        });
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(amount: 100));

        Assert.Equal(PaymentCallbackApplicationState.Applied, result.ApplicationState);
        Assert.Equal(ReservationStatus.Confirmed, (await harness.Context.Reservations.FindAsync(10))!.Status);
        rejected = (await harness.Context.Reservations.FindAsync(11))!;
        Assert.Equal(ReservationStatus.Rejected, rejected.Status);
        Assert.Equal("Owner rejected this reservation.", rejected.CancellationNote);
        Assert.Equal(rejectedPaymentDeadline, rejected.PaymentExpiresAtUtc);
        Assert.Equal(rejectedApprovalDeadline, rejected.ApprovalExpiresAtUtc);
        Assert.Single(await harness.Context.PaymentItems.ToListAsync());
        Assert.Equal(300, await harness.Context.Reservations.SumAsync(item => item.TotalPrice));
        Assert.Equal(2, await harness.Context.AuditLogs.CountAsync());
        Assert.Single(await harness.Context.AuditLogs.Where(log => log.EntityId == 11).ToListAsync());
        Assert.Single(await harness.Context.NotificationLogs.ToListAsync());
        Assert.DoesNotContain(
            await harness.Context.NotificationLogs.ToListAsync(),
            notification => notification.ReservationId == 11);
    }

    [Fact]
    public async Task MixedPayment_WithTwoIncludedChildren_AppliesAtomically()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, ReservationStatus.Rejected);
        harness.Context.RoomTypes.Add(RoomType(12));
        harness.Context.Reservations.Add(Reservation(12, 300, DateTime.UtcNow.AddMinutes(45)));
        harness.Context.PaymentItems.Add(new PaymentItem
        {
            Id = 1002,
            PaymentId = 100,
            ReservationId = 12,
            AllocatedAmount = 300,
            Currency = "IRR"
        });
        (await harness.Context.Payments.FindAsync(100))!.Amount = 400;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(amount: 400));

        Assert.Equal(PaymentCallbackApplicationState.Applied, result.ApplicationState);
        Assert.Equal(
            new[] { ReservationStatus.Confirmed, ReservationStatus.Rejected, ReservationStatus.Confirmed },
            (await harness.Context.Reservations.OrderBy(item => item.Id).ToListAsync())
                .Select(item => item.Status));
        Assert.Equal(new[] { 10, 12 },
            (await harness.Context.PaymentItems.OrderBy(item => item.ReservationId).ToListAsync())
                .Select(item => item.ReservationId));
        Assert.Equal(2, await harness.Context.AuditLogs.CountAsync());
        Assert.Equal(2, await harness.Context.NotificationLogs.CountAsync());
    }

    [Fact]
    public async Task MixedPayment_SecondIncludedChildFailureLeavesEveryChildUnchanged()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, ReservationStatus.Rejected);
        harness.Context.RoomTypes.Add(RoomType(12));
        harness.Context.Reservations.Add(Reservation(12, 300, DateTime.UtcNow.AddMinutes(-1)));
        harness.Context.PaymentItems.Add(new PaymentItem
        {
            Id = 1002,
            PaymentId = 100,
            ReservationId = 12,
            AllocatedAmount = 300,
            Currency = "IRR"
        });
        (await harness.Context.Payments.FindAsync(100))!.Amount = 400;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(amount: 400));

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Equal(
            new[]
            {
                ReservationStatus.ApprovedAwaitingPayment,
                ReservationStatus.Rejected,
                ReservationStatus.ApprovedAwaitingPayment
            },
            (await harness.Context.Reservations.OrderBy(item => item.Id).ToListAsync())
                .Select(item => item.Status));
        Assert.Empty(await harness.Context.AuditLogs.ToListAsync());
        Assert.Empty(await harness.Context.NotificationLogs.ToListAsync());
    }

    [Theory]
    [InlineData(ReservationStatus.PendingApproval)]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.PaymentExpired)]
    public async Task MixedPayment_RejectsUnsupportedExcludedChild(ReservationStatus excludedStatus)
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, excludedStatus);

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(amount: 100));

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, (await harness.Context.Reservations.FindAsync(10))!.Status);
        Assert.Equal(excludedStatus, (await harness.Context.Reservations.FindAsync(11))!.Status);
        Assert.Empty(await harness.Context.AuditLogs.ToListAsync());
        Assert.Empty(await harness.Context.NotificationLogs.ToListAsync());
    }

    [Fact]
    public async Task DuplicatePaymentItemCoverage_IsRejected()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.PaymentItems.Add(new PaymentItem
        {
            Id = 1002,
            PaymentId = 100,
            ReservationId = 10,
            AllocatedAmount = 100,
            Currency = "IRR"
        });
        (await harness.Context.Payments.FindAsync(100))!.Amount = 400;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(amount: 400));

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
    }

    [Fact]
    public async Task DuplicateMixedCallback_DoesNotDuplicateAuditOrNotification()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, ReservationStatus.Rejected);
        var callback = harness.Callback(amount: 100);

        var first = await harness.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback);
        var duplicate = await harness.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback);

        Assert.Equal(PaymentCallbackApplicationState.Applied, first.ApplicationState);
        Assert.True(duplicate.IsDuplicate);
        Assert.Single(await harness.Context.AuditLogs.ToListAsync());
        Assert.Single(await harness.Context.NotificationLogs.ToListAsync());
        Assert.Equal(ReservationStatus.Rejected, (await harness.Context.Reservations.FindAsync(11))!.Status);
    }

    [Fact]
    public async Task ConcurrentMixedCallbacks_ApplyOnceWithoutPartialState()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await ExcludeChildAsync(harness, 11, ReservationStatus.Rejected);
        await using var firstScope = harness.CreateServiceScope();
        await using var secondScope = harness.CreateServiceScope();
        var callback = harness.Callback(amount: 100);

        var results = await Task.WhenAll(
            firstScope.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback),
            secondScope.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback));

        Assert.All(results, result => Assert.Equal(PaymentCallbackApplicationState.Applied, result.ApplicationState));
        Assert.Single(results, result => result.IsDuplicate);
        await using var verification = harness.CreateContext();
        Assert.Equal(
            new[] { ReservationStatus.Confirmed, ReservationStatus.Rejected },
            (await verification.Reservations.OrderBy(item => item.Id).ToListAsync())
                .Select(item => item.Status));
        Assert.Single(await verification.AuditLogs.ToListAsync());
        Assert.Single(await verification.NotificationLogs.ToListAsync());
        Assert.Single(await verification.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task InvalidSecondChild_RollsBackTheWholeSessionApplication()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        (await harness.Context.Reservations.FindAsync(11))!.Status = ReservationStatus.Rejected;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.FindAsync(10))!.Status);
        Assert.Equal(ReservationStatus.Rejected, (await harness.Context.Reservations.FindAsync(11))!.Status);
        Assert.Empty(await harness.Context.AuditLogs.ToListAsync());
        Assert.Empty(await harness.Context.NotificationLogs.ToListAsync());
    }

    [Fact]
    public async Task ExpiredChild_PreventsEveryReservationFromBeingConfirmed()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        (await harness.Context.Reservations.FindAsync(11))!.PaymentExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1);
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
    }

    [Fact]
    public async Task AllocationMismatch_DoesNotApplyThePayment()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        (await harness.Context.PaymentItems.SingleAsync(item => item.ReservationId == 10)).AllocatedAmount = 101;
        (await harness.Context.PaymentItems.SingleAsync(item => item.ReservationId == 11)).AllocatedAmount = 199;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Null((await harness.Context.Payments.FindAsync(100))!.AppliedAtUtc);
    }

    [Fact]
    public async Task RetryAfterChildCorrection_AppliesTheSameDurablePayment()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        (await harness.Context.Reservations.FindAsync(11))!.Status = ReservationStatus.Rejected;
        await harness.Context.SaveChangesAsync();
        var failed = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());
        (await harness.Context.Reservations.FindAsync(11))!.Status =
            ReservationStatus.ApprovedAwaitingPayment;
        await harness.Context.SaveChangesAsync();

        var retried = await harness.Service.RetryApplicationAsync(100);

        Assert.Equal(PaymentCallbackApplicationState.Failed, failed.ApplicationState);
        Assert.Equal(PaymentCallbackApplicationState.Applied, retried.ApplicationState);
        Assert.Equal(failed.ReceiptId, retried.ReceiptId);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
        Assert.All(
            await harness.Context.Reservations.Where(reservation => reservation.BookingSessionId == 1).ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.Confirmed, reservation.Status));
    }

    [Fact]
    public async Task ReservationCurrencyMismatch_DoesNotApplyThePayment()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        (await harness.Context.Reservations.FindAsync(11))!.Currency = "USD";
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
    }

    [Fact]
    public async Task PaymentItemOutsideSession_IsRejectedWithoutPartialApplication()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.BookingSessions.Add(new BookingSession
        {
            Id = 2,
            SessionCode = "KCH-S-OTHER",
            ClientId = 1,
            PropertyId = 1,
            Currency = "IRR"
        });
        (await harness.Context.Reservations.FindAsync(11))!.BookingSessionId = 2;
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
    }

    [Fact]
    public async Task CapacityRecheckFailure_NeverAppliesPartialCapacityLost()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.Reservations.Add(new Reservation
        {
            Id = 12,
            ReservationNumber = "KCH-R-12",
            ClientId = 2,
            PropertyId = 1,
            RoomTypeId = 10,
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            AdultCount = 1,
            TotalPrice = 50,
            FinalAmount = 50,
            Currency = "IRR",
            Status = ReservationStatus.Confirmed,
            Source = ReservationSource.AdminCreated
        });
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.FindAsync(10))!.Status);
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.FindAsync(11))!.Status);
        Assert.DoesNotContain(
            await harness.Context.Reservations.ToListAsync(),
            reservation => reservation.Status == ReservationStatus.CapacityLost);
    }

    [Fact]
    public async Task SuccessfulSessionPayment_ConsumesEveryActiveChildToken()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.ReservationPaymentLinkTokens.AddRange(
            new ReservationPaymentLinkToken
            {
                ReservationId = 10,
                TokenHash = "token-10",
                ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
            },
            new ReservationPaymentLinkToken
            {
                ReservationId = 11,
                TokenHash = "token-11",
                ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
            });
        await harness.Context.SaveChangesAsync();

        await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.All(
            await harness.Context.ReservationPaymentLinkTokens.ToListAsync(),
            token => Assert.NotNull(token.UsedAtUtc));
    }

    [Fact]
    public async Task PreviousSuccessfulPayment_PreventsDoubleCounting()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.Payments.Add(new Payment
        {
            Id = 102,
            ReservationId = 10,
            Amount = 100,
            Currency = "IRR",
            Provider = "legacy",
            TransactionReference = "already-paid",
            Status = PaymentStatus.Successful,
            PaidAtUtc = DateTime.UtcNow
        });
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        Assert.Null((await harness.Context.Payments.FindAsync(100))!.AppliedAtUtc);
    }

    [Fact]
    public async Task InvalidSignature_IsRejectedBeforePersistence()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        var callback = harness.Callback();
        callback = callback with
        {
            Headers = new Dictionary<string, string>
            {
                [InternalTestPaymentProvider.SignatureHeaderName] = "invalid"
            }
        };

        await Assert.ThrowsAsync<PaymentProviderValidationException>(() =>
            harness.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback));

        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
        Assert.Null((await harness.Context.Payments.FindAsync(100))!.ProviderConfirmedAtUtc);
    }

    [Fact]
    public async Task AmountMismatch_IsRejectedWithoutAReceipt()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ReceiveAsync(
                InternalTestPaymentProvider.ProviderName,
                harness.Callback(amount: 301)));

        Assert.Contains("amount", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task CurrencyMismatch_IsRejectedWithoutAReceipt()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ReceiveAsync(
                InternalTestPaymentProvider.ProviderName,
                harness.Callback(currency: "USD")));

        Assert.Contains("currency", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task DuplicateCallback_ReturnsTheExistingReceiptAndResult()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        var callback = harness.Callback();
        var first = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            callback);

        var duplicate = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            callback);

        Assert.True(duplicate.IsDuplicate);
        Assert.Equal(first.PaymentId, duplicate.PaymentId);
        Assert.Equal(first.ReceiptId, duplicate.ReceiptId);
        Assert.Equal(first.ApplicationState, duplicate.ApplicationState);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task ConcurrentCallbacks_ReturnOneDurableReceipt()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        await using var firstScope = harness.CreateServiceScope();
        await using var secondScope = harness.CreateServiceScope();
        var callback = harness.Callback();

        var results = await Task.WhenAll(
            firstScope.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback),
            secondScope.Service.ReceiveAsync(InternalTestPaymentProvider.ProviderName, callback));

        Assert.Equal(results[0].ReceiptId, results[1].ReceiptId);
        Assert.Single(results, result => result.IsDuplicate);
        await using var verification = harness.CreateContext();
        Assert.Single(await verification.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task DomainFailure_KeepsReceiptAndRollsBackPartialReservationChanges()
    {
        var handler = new TestDomainApplicationHandler { ThrowAfterFirstReservation = true };
        await using var harness = await PaymentCallbackHarness.CreateAsync(handler);

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());

        Assert.Equal(PaymentCallbackApplicationState.Failed, result.ApplicationState);
        await using var verification = harness.CreateContext();
        Assert.Single(await verification.PaymentCallbackReceipts.ToListAsync());
        var payment = await verification.Payments.SingleAsync(payment => payment.Id == 100);
        Assert.NotNull(payment.ProviderConfirmedAtUtc);
        Assert.NotNull(payment.FailedAtUtc);
        Assert.Null(payment.AppliedAtUtc);
        Assert.Contains("InvalidOperationException", payment.ProcessingError);
        Assert.All(
            await verification.Reservations.ToListAsync(),
            reservation => Assert.Equal(
                ReservationStatus.ApprovedAwaitingPayment,
                reservation.Status));
    }

    [Fact]
    public async Task RetryAfterDomainFailure_AppliesWithoutCreatingAnotherReceipt()
    {
        var handler = new TestDomainApplicationHandler { ThrowAfterFirstReservation = true };
        await using var harness = await PaymentCallbackHarness.CreateAsync(handler);
        var failed = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback());
        handler.ThrowAfterFirstReservation = false;
        handler.Outcome = PaymentDomainApplicationOutcome.Applied;

        var retried = await harness.Service.RetryApplicationAsync(100);

        Assert.Equal(PaymentCallbackApplicationState.Failed, failed.ApplicationState);
        Assert.Equal(PaymentCallbackApplicationState.Applied, retried.ApplicationState);
        Assert.Equal(failed.ReceiptId, retried.ReceiptId);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
        var payment = await harness.Context.Payments.SingleAsync(payment => payment.Id == 100);
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.NotNull(payment.AppliedAtUtc);
        Assert.Null(payment.FailedAtUtc);
        Assert.Null(payment.ProcessingError);
    }

    [Fact]
    public async Task LegacyReservationPayment_CanReceiveAValidatedReceipt()
    {
        await using var harness = await PaymentCallbackHarness.CreateAsync();
        harness.Context.RoomTypes.Add(new RoomType
        {
            Id = 12,
            PropertyId = 1,
            Name = "Legacy room type",
            Slug = "legacy-room-type",
            TotalInventory = 1,
            InventoryMode = InventoryMode.TypeBasedInventory
        });
        harness.Context.Reservations.Add(new Reservation
        {
            Id = 12,
            ReservationNumber = "KCH-R-LEGACY",
            ClientId = 1,
            PropertyId = 1,
            RoomTypeId = 12,
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            AdultCount = 1,
            TotalPrice = 100,
            FinalAmount = 100,
            Currency = "IRR",
            Status = ReservationStatus.ApprovedAwaitingPayment,
            Source = ReservationSource.Website,
            PaymentExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        harness.Context.Payments.Add(new Payment
        {
            Id = 101,
            ReservationId = 12,
            Amount = 100,
            Currency = "IRR",
            Provider = InternalTestPaymentProvider.ProviderName,
            Status = PaymentStatus.Pending
        });
        await harness.Context.SaveChangesAsync();

        var result = await harness.Service.ReceiveAsync(
            InternalTestPaymentProvider.ProviderName,
            harness.Callback(paymentId: 101, amount: 100, eventId: "legacy-event"));

        Assert.Equal(101, result.PaymentId);
        Assert.Equal(PaymentCallbackApplicationState.Applied, result.ApplicationState);
        Assert.Contains(
            await harness.Context.PaymentCallbackReceipts.ToListAsync(),
            receipt => receipt.PaymentId == 101);
        Assert.Equal(
            ReservationStatus.Confirmed,
            (await harness.Context.Reservations.FindAsync(12))!.Status);
    }

    [Fact]
    public void ProviderContract_ExposesCallbackRateLimitPolicyAndUsesNoExternalGateway()
    {
        var provider = new InternalTestPaymentProvider(PaymentCallbackHarness.SigningSecret);

        Assert.Equal(PaymentCallbackRateLimitPolicy.Name, provider.CallbackRateLimitPolicyName);
        Assert.Equal(InternalTestPaymentProvider.ProviderName, provider.ProviderKey);
        Assert.Equal("درگاه آزمایشی", provider.DisplayLabel);
        Assert.True(provider.IsSelectableForAccountCheckout);
    }

    private static async Task ExcludeChildAsync(
        PaymentCallbackHarness harness,
        int reservationId,
        ReservationStatus excludedStatus)
    {
        var item = await harness.Context.PaymentItems
            .SingleAsync(candidate => candidate.ReservationId == reservationId);
        harness.Context.PaymentItems.Remove(item);
        var payment = await harness.Context.Payments.SingleAsync(candidate => candidate.Id == 100);
        payment.Amount -= item.AllocatedAmount;
        (await harness.Context.Reservations.FindAsync(reservationId))!.Status = excludedStatus;
        await harness.Context.SaveChangesAsync();
    }

    private static RoomType RoomType(int id) => new()
    {
        Id = id,
        PropertyId = 1,
        Name = $"Room type {id}",
        Slug = $"room-type-{id}",
        TotalInventory = 1,
        InventoryMode = InventoryMode.TypeBasedInventory
    };

    private static Reservation Reservation(int id, decimal amount, DateTime deadline) => new()
    {
        Id = id,
        BookingSessionId = 1,
        ReservationNumber = $"KCH-R-{id}",
        ClientId = 1,
        PropertyId = 1,
        RoomTypeId = id,
        CheckInDate = new DateOnly(2036, 1, 1),
        CheckOutDate = new DateOnly(2036, 1, 2),
        AdultCount = 1,
        TotalPrice = amount,
        FinalAmount = amount,
        Currency = "IRR",
        Status = ReservationStatus.ApprovedAwaitingPayment,
        Source = ReservationSource.Website,
        PaymentExpiresAtUtc = deadline
    };

    private sealed class TestDomainApplicationHandler : IPaymentDomainApplicationHandler
    {
        public bool ThrowAfterFirstReservation { get; set; }
        public PaymentDomainApplicationOutcome Outcome { get; set; } =
            PaymentDomainApplicationOutcome.Deferred;

        public Task<PaymentDomainApplicationOutcome> ApplyAsync(
            Payment payment,
            CancellationToken cancellationToken = default)
        {
            if (ThrowAfterFirstReservation)
            {
                payment.Status = PaymentStatus.Successful;
                throw new InvalidOperationException("Simulated domain failure.");
            }

            return Task.FromResult(Outcome);
        }
    }

    private sealed class PaymentCallbackHarness : IAsyncDisposable
    {
        internal const string SigningSecret = "local-test-secret";
        private readonly DbContextOptions<KoochDbContext> options;
        private readonly IPaymentDomainApplicationHandler? handler;

        private PaymentCallbackHarness(
            DbContextOptions<KoochDbContext> options,
            KoochDbContext context,
            IPaymentDomainApplicationHandler? handler)
        {
            this.options = options;
            this.handler = handler;
            Context = context;
            Service = CreateService(context);
        }

        public KoochDbContext Context { get; }
        public PaymentCallbackService Service { get; }

        public static async Task<PaymentCallbackHarness> CreateAsync(
            IPaymentDomainApplicationHandler? handler = null)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"payment-callback-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var context = new KoochDbContext(options);
            var deadline = DateTime.UtcNow.AddHours(1);
            context.BookingSessions.Add(new BookingSession
            {
                Id = 1,
                SessionCode = "KCH-S-CALLBACK",
                ClientId = 1,
                PropertyId = 1,
                Currency = "IRR"
            });
            context.Reservations.AddRange(
                Reservation(10, 100, deadline),
                Reservation(11, 200, deadline));
            context.RoomTypes.AddRange(
                RoomType(10),
                RoomType(11));
            var payment = new Payment
            {
                Id = 100,
                BookingSessionId = 1,
                Amount = 300,
                Currency = "IRR",
                Provider = InternalTestPaymentProvider.ProviderName,
                IdempotencyKey = "payment-key",
                RequestHash = new string('A', 64),
                Status = PaymentStatus.Pending,
                Items =
                [
                    new PaymentItem { Id = 1000, ReservationId = 10, AllocatedAmount = 100, Currency = "IRR" },
                    new PaymentItem { Id = 1001, ReservationId = 11, AllocatedAmount = 200, Currency = "IRR" }
                ]
            };
            context.Payments.Add(payment);
            await context.SaveChangesAsync();
            return new PaymentCallbackHarness(
                options,
                context,
                handler);
        }

        public PaymentProviderCallbackContext Callback(
            int paymentId = 100,
            decimal amount = 300,
            string currency = "IRR",
            string eventId = "event-1",
            string transactionReference = "transaction-1")
        {
            var body = InternalTestPaymentProvider.SerializePayload(new InternalTestPaymentCallbackPayload
            {
                PaymentId = paymentId,
                ProviderEventId = eventId,
                TransactionReference = transactionReference,
                Amount = amount,
                Currency = currency,
                IsSuccessful = true,
                ProviderOccurredAtUtc = DateTime.UtcNow
            });
            return new PaymentProviderCallbackContext(
                body,
                new Dictionary<string, string>
                {
                    [InternalTestPaymentProvider.SignatureHeaderName] =
                        InternalTestPaymentProvider.CreateSignature(body, SigningSecret)
                });
        }

        public PaymentCallbackServiceScope CreateServiceScope()
        {
            var context = CreateContext();
            return new PaymentCallbackServiceScope(context, CreateService(context));
        }

        public KoochDbContext CreateContext() => new(options);

        public ValueTask DisposeAsync() => Context.DisposeAsync();

        private PaymentCallbackService CreateService(KoochDbContext context) =>
            new(
                context,
                [new InternalTestPaymentProvider(SigningSecret)],
                handler is null
                    ? new PaymentDomainApplicationHandler(
                        context,
                        new EffectiveAvailabilityService(context))
                    : handler);

        private static RoomType RoomType(int id) =>
            new()
            {
                Id = id,
                PropertyId = 1,
                Name = $"Room type {id}",
                Slug = $"room-type-{id}",
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            };

        private static Reservation Reservation(int id, decimal amount, DateTime deadline) =>
            new()
            {
                Id = id,
                BookingSessionId = 1,
                ReservationNumber = $"KCH-R-{id}",
                ClientId = 1,
                PropertyId = 1,
                RoomTypeId = id,
                CheckInDate = new DateOnly(2036, 1, 1),
                CheckOutDate = new DateOnly(2036, 1, 2),
                AdultCount = 1,
                TotalPrice = amount,
                FinalAmount = amount,
                Currency = "IRR",
                Status = ReservationStatus.ApprovedAwaitingPayment,
                Source = ReservationSource.Website,
                PaymentExpiresAtUtc = deadline
            };
    }

    private sealed class PaymentCallbackServiceScope(
        KoochDbContext context,
        PaymentCallbackService service) : IAsyncDisposable
    {
        public PaymentCallbackService Service { get; } = service;
        public ValueTask DisposeAsync() => context.DisposeAsync();
    }
}
