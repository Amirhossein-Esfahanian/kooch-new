using System.Reflection;
using Kooch.Api.Controllers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class ReservationWalletFundingTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(40)]
    [InlineData(300)]
    public async Task ReceptionGate_BlocksNewCardMixedAndWalletOnlyAttempts(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        var session = await db.Context.BookingSessions.SingleAsync();
        session.ReceptionCoordinationRequired = true;
        // No reception configuration: the stored requirement, not current hours, controls payment.
        await db.Context.SaveChangesAsync();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CoordinationAccountPayment(db).InitiateAsync(1, session.SessionCode,
                wallet == 300 ? "" : InternalTestPaymentProvider.ProviderName, "coordination", wallet));
        Assert.Contains("هماهنگی", error.Message);
        Assert.Empty(await db.Context.Payments.ToListAsync());
        Assert.Empty(await db.Context.BookingFundingAttempts.ToListAsync());
        Assert.Empty(await db.Context.WalletHolds.ToListAsync());
        Assert.Empty(await db.Debits());
        Assert.All(await db.Context.Reservations.ToListAsync(), r =>
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status));
    }

    [Theory]
    [InlineData(false, 0)]
    [InlineData(false, 40)]
    [InlineData(false, 300)]
    [InlineData(true, 0)]
    [InlineData(true, 40)]
    [InlineData(true, 300)]
    public async Task ReceptionGate_NotRequiredOrAcknowledgedPreservesFunding(bool required, decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        var session = await db.Context.BookingSessions.SingleAsync();
        session.ReceptionCoordinationRequired = required;
        session.ReceptionCoordinationAcknowledgedAtUtc = required ? DateTime.UtcNow.AddMinutes(-1) : null;
        // Invalid live reception settings would fail evaluation, but must never be evaluated here.
        (await db.Context.Properties.SingleAsync()).RegularReceptionFrom = new TimeOnly(14, 0);
        await db.Context.SaveChangesAsync();
        var result = await CoordinationAccountPayment(db).InitiateAsync(1, session.SessionCode,
            wallet == 300 ? "" : InternalTestPaymentProvider.ProviderName, "coordination", wallet);
        Assert.Equal(300 - wallet, result.Amount);
        Assert.Equal(wallet, result.WalletAmount);
        Assert.Equal(wallet == 300, result.FundingCompleted);
        Assert.Equal(300, (await db.Context.Reservations.ToListAsync()).Sum(r => r.FinalAmount));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(40)]
    [InlineData(300)]
    public async Task ReceptionGate_ExistingAttemptsAndCallbacksRemainValid(decimal wallet)
    {
        using var db = new Database();
        await db.Credit(300);
        // Represents an in-flight attempt created before the initiation gate was deployed.
        var original = await db.Checkout(wallet, "existing");
        var session = await db.Context.BookingSessions.SingleAsync();
        session.ReceptionCoordinationRequired = true;
        await db.Context.SaveChangesAsync();
        var replay = await CoordinationAccountPayment(db).InitiateAsync(1, session.SessionCode,
            InternalTestPaymentProvider.ProviderName, "existing", wallet);
        Assert.True(replay.IsReplay);
        Assert.Equal(original.PaymentId, replay.PaymentId);
        if (wallet < 300) await db.Callback();
        Assert.All(await db.Context.Reservations.ToListAsync(), r => Assert.Equal(ReservationStatus.Confirmed, r.Status));
    }

    [Theory]
    [InlineData(ReservationStatus.PendingApproval)]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment)]
    public async Task ReceptionAcknowledgement_UsesServerTimeAndPreservesLifecycle(ReservationStatus status)
    {
        using var db = new Database();
        var session = await db.Context.BookingSessions.SingleAsync();
        session.ReceptionCoordinationRequired = true;
        var reservations = await db.Context.Reservations.ToListAsync();
        foreach (var r in reservations) r.Status = status;
        await db.Context.SaveChangesAsync();
        var before = reservations.Select(r => (r.Status, r.PaymentExpiresAtUtc, r.ApprovalExpiresAtUtc, r.FinalAmount)).ToArray();
        var clock = new CoordinationClock(new DateTimeOffset(2026, 10, 13, 12, 0, 0, TimeSpan.Zero));
        var service = new BookingSessionReceptionCoordinationService(db.Context, clock);
        await service.AcknowledgeAsync(1, " O-123456 ");
        clock.Now = clock.Now.AddHours(1);
        await service.AcknowledgeAsync(1, "O-123456");
        db.Context.ChangeTracker.Clear();
        var saved = await db.Context.BookingSessions.SingleAsync();
        Assert.Equal(clock.Now.AddHours(-1).UtcDateTime, saved.ReceptionCoordinationAcknowledgedAtUtc);
        Assert.True(saved.ReceptionCoordinationRequired);
        Assert.Equal(before, (await db.Context.Reservations.OrderBy(r => r.Id).ToListAsync())
            .Select(r => (r.Status, r.PaymentExpiresAtUtc, r.ApprovalExpiresAtUtc, r.FinalAmount)).ToArray());
        Assert.Empty(await db.Context.Payments.ToListAsync());
        Assert.Empty(await db.Context.WalletEntries.ToListAsync());
        var read = await new BookingSessionQueryService(db.Context).GetBySessionCodeForClientAsync(1, "O-123456");
        Assert.Equal(saved.ReceptionCoordinationAcknowledgedAtUtc, read.ReceptionCoordinationAcknowledgedAtUtc);
        if (status == ReservationStatus.PendingApproval)
        {
            Assert.False(read.Summary.IsPaymentReady);
            await Assert.ThrowsAsync<InvalidOperationException>(() => CoordinationAccountPayment(db)
                .InitiateAsync(1, "O-123456", InternalTestPaymentProvider.ProviderName, "still-pending"));
        }
    }

    [Fact]
    public async Task ReceptionAcknowledgement_OwnershipRequiredAndNotRequiredIsNoOp()
    {
        using var db = new Database();
        var service = new BookingSessionReceptionCoordinationService(db.Context, TimeProvider.System);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.AcknowledgeAsync(0, "O-123456"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.AcknowledgeAsync(2, "O-123456"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.AcknowledgeAsync(1, "O-999999"));
        await service.AcknowledgeAsync(1, "O-123456");
        Assert.Null((await db.Context.BookingSessions.AsNoTracking().SingleAsync()).ReceptionCoordinationAcknowledgedAtUtc);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => CoordinationAccountPayment(db)
            .InitiateAsync(2, "O-123456", InternalTestPaymentProvider.ProviderName, "not-owner"));
    }

    [Fact]
    public void ReceptionAcknowledgement_AuthenticatedActionHasNoClientTimestampOrRequirementInput()
    {
        Assert.NotNull(typeof(AccountBookingSessionsController).GetCustomAttribute<AuthorizeAttribute>());
        var action = typeof(AccountBookingSessionsController).GetMethod(nameof(AccountBookingSessionsController.AcknowledgeReceptionCoordination))!;
        Assert.Equal("{sessionCode}/reception-coordination/acknowledge", action.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Equal(new[] { typeof(string), typeof(BookingSessionReceptionCoordinationService), typeof(CancellationToken) },
            action.GetParameters().Select(p => p.ParameterType).ToArray());
        Assert.DoesNotContain(action.GetParameters(), p => p.GetCustomAttribute<FromBodyAttribute>() != null);
    }

    [Fact]
    public async Task ReceptionGate_DoesNotAlterInternalPaymentBoundary()
    {
        using var db = new Database();
        (await db.Context.BookingSessions.SingleAsync()).ReceptionCoordinationRequired = true;
        await db.Context.SaveChangesAsync();
        var result = await db.Checkout(0);
        Assert.Equal(300, result.Amount);
    }

    private static AccountBookingSessionPaymentService CoordinationAccountPayment(Database db) =>
        new(db.Context, new PaymentService(db.Context, new Availability()), [new InternalTestPaymentProvider("secret")]);

    private sealed class CoordinationClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
