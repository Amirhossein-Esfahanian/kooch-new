using System.Data.Common;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    [SqlServerWalletFact]
    public async Task ReviewProtection_TimelyReceiptKeepsOriginalDeadlineAndCapacityInWorkerAndReadPaths()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        await using (var worker = Open())
            await Reservations(worker).ExpireApprovedUnpaidReservationsAsync(100);
        await using (var read = Open())
            await Reservations(read).GetByIdAsync(review.ReservationId, review.Seed.PropertyId);
        await AssertReviewAsync(review, ReservationStatus.ApprovedAwaitingPayment, PaymentStatus.Pending,
            ManualPaymentVerificationStatus.PendingVerification, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_LateSubmissionCannotUseOperatorPaymentDateAndWritesNothing()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        int id;
        await using (var setup = Open())
        {
            id = await setup.Reservations.Where(r => r.BookingSessionId == order).Select(r => r.Id).FirstAsync();
            await setup.Reservations.Where(r => r.Id == id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(r => r.PaymentExpiresAtUtc, DateTime.UtcNow.AddMinutes(-1)));
        }
        await using (var submit = Open())
        {
            var error = await Assert.ThrowsAsync<ManualPaymentReviewException>(() =>
                Payments(submit).CreateAsync(ReviewReceipt(id), seed.AdminId));
            Assert.Equal(ManualPaymentReviewException.DeadlineExpired, error.Code);
        }
        await using var verify = Open();
        Assert.False(await verify.Payments.AnyAsync(p => p.ReservationId == id));
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, (await verify.Reservations.SingleAsync(r => r.Id == id)).Status);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_ReceiptAtDeadlineOrLaterDoesNotProtect()
    {
        foreach (var offset in new[] { TimeSpan.Zero, TimeSpan.FromMinutes(1) })
        {
            var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
            await using (var setup = Open())
                await setup.Payments.Where(p => p.Id == review.PaymentId).ExecuteUpdateAsync(setters =>
                    setters.SetProperty(p => p.CreatedAtUtc, review.Deadline.Add(offset)));
            await using (var expire = Open())
                Assert.True(await Reservations(expire).ExpirePaymentWindowAsync(review.ReservationId));
            await AssertReviewAsync(review, ReservationStatus.PaymentExpired, PaymentStatus.Pending,
                ManualPaymentVerificationStatus.PendingVerification, remaining: 1);
        }
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_ApprovalDuringProtectionConfirmsOnlyItsRoom()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        await using (var approve = Open())
            await Payments(approve).ApproveAsync(review.PaymentId, review.Seed.AdminId);
        await AssertReviewAsync(review, ReservationStatus.Confirmed, PaymentStatus.Successful,
            ManualPaymentVerificationStatus.Approved, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_RejectionAfterDeadlineAllowsNormalExpiration()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        await using (var reject = Open())
            await Payments(reject).RejectAsync(review.PaymentId, new() { Reason = "Synthetic rejected evidence" }, review.Seed.AdminId);
        await using (var read = Open())
            await Reservations(read).GetByIdAsync(review.ReservationId, review.Seed.PropertyId);
        await AssertReviewAsync(review, ReservationStatus.PaymentExpired, PaymentStatus.Failed,
            ManualPaymentVerificationStatus.Rejected, remaining: 1);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_TimeoutReleasesCapacityButRetainsPendingReceiptAndRejectsApproval()
    {
        var review = await PendingReviewAsync(TimeSpan.FromHours(24));
        await using (var worker = Open())
            await Reservations(worker).ExpireApprovedUnpaidReservationsAsync(100);
        await using (var approve = Open())
        {
            var error = await Assert.ThrowsAsync<ManualPaymentReviewException>(() =>
                Payments(approve).ApproveAsync(review.PaymentId, review.Seed.AdminId));
            Assert.Equal(ManualPaymentReviewException.DeadlineExpired, error.Code);
        }
        await AssertReviewAsync(review, ReservationStatus.PaymentExpired, PaymentStatus.Pending,
            ManualPaymentVerificationStatus.PendingVerification, remaining: 1);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_ReadApproveRejectEnforcePropertyAndGlobalPermission()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        foreach (var (permission, property) in new[] { (true, false), (false, true) })
        {
            await using var denied = Open();
            var service = Payments(denied, permission, property);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetByReservationAsync(review.ReservationId, review.Seed.AdminId));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ApproveAsync(review.PaymentId, review.Seed.AdminId));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.RejectAsync(review.PaymentId,
                new() { Reason = "Denied" }, review.Seed.AdminId));
        }
        await AssertReviewAsync(review, ReservationStatus.ApprovedAwaitingPayment, PaymentStatus.Pending,
            ManualPaymentVerificationStatus.PendingVerification, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_RealAuthorizationDeniesAdminWithoutPropertyMembership()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        int outsiderId;
        await using (var setup = Open())
        {
            var outsider = new User { FirstName = "Review", LastName = "Out of scope", Role = UserRole.AdminAssistant, IsActive = true };
            setup.Users.Add(outsider);
            await setup.SaveChangesAsync();
            outsiderId = outsider.Id;
            if (!await setup.Permissions.AnyAsync(p => p.Key == PermissionKey.ManagePayments))
            {
                setup.Permissions.Add(new Permission { Key = PermissionKey.ManagePayments, Name = "Synthetic payment review" });
                await setup.SaveChangesAsync();
            }
            setup.UserPermissions.Add(new UserPermission { UserId = outsiderId, PermissionKey = PermissionKey.ManagePayments, IsAllowed = true });
            await setup.SaveChangesAsync();
        }
        await using (var denied = Open())
        {
            var access = new PropertyAccessService(denied);
            var permissions = new PermissionService(denied, access);
            Assert.True(await permissions.HasPermissionAsync(outsiderId, PermissionKey.ManagePayments));
            Assert.False(await access.CanAccessPropertyAsync(outsiderId, review.Seed.PropertyId));
            var service = new AdminManualPaymentService(denied, new EffectiveAvailabilityService(denied),
                new PaymentFinancializationService(denied, new CommissionPolicyResolver(denied)),
                new ReservationVoucherService(denied, new VoucherNumberGenerator(denied)), permissions, access);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetByReservationAsync(review.ReservationId, outsiderId));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ApproveAsync(review.PaymentId, outsiderId));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.RejectAsync(review.PaymentId, new() { Reason = "Denied" }, outsiderId));
            // The existing global SuperAdmin access remains available through the real services.
            Assert.Single(await service.GetByReservationAsync(review.ReservationId, review.Seed.AdminId));
        }
        await AssertReviewAsync(review, ReservationStatus.ApprovedAwaitingPayment, PaymentStatus.Pending,
            ManualPaymentVerificationStatus.PendingVerification, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_OverlapBeforeWritesUsesSessionFirstWithoutInvertedReservationLock()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        var gate = new ReviewSessionGate();
        var signal = new CommandSignal();
        await using var approvalDb = Open(gate);
        await using var expiryDb = Open(signal);
        var approve = Payments(approvalDb).ApproveAsync(review.PaymentId, review.Seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var expire = Reservations(expiryDb).ExpirePaymentWindowAsync(review.ReservationId);
        try
        {
            await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(approve.IsCompleted);
            Assert.False(expire.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        await approve.WaitAsync(TimeSpan.FromSeconds(60));
        Assert.False(await expire.WaitAsync(TimeSpan.FromSeconds(60)));
        await AssertReviewAsync(review, ReservationStatus.Confirmed, PaymentStatus.Successful,
            ManualPaymentVerificationStatus.Approved, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_OverlappingApprovalAndExpirationKeepConfirmationAndCapacity()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        var gate = new CommitGate();
        var signal = new ReviewCommandSignal();
        await using var approvalDb = Open(gate);
        await using var expiryDb = Open(signal);
        var approve = Payments(approvalDb).ApproveAsync(review.PaymentId, review.Seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var expire = Reservations(expiryDb).ExpirePaymentWindowAsync(review.ReservationId);
        await AssertReviewOverlapAsync(gate, signal, approve, expire);
        await approve.WaitAsync(TimeSpan.FromSeconds(60));
        Assert.False(await expire.WaitAsync(TimeSpan.FromSeconds(60)));
        await AssertReviewAsync(review, ReservationStatus.Confirmed, PaymentStatus.Successful,
            ManualPaymentVerificationStatus.Approved, remaining: 0);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_OverlappingTimeoutAndApprovalCannotConfirmReleasedCapacity()
    {
        var review = await PendingReviewAsync(TimeSpan.FromHours(25));
        var gate = new CommitGate();
        var signal = new ReviewCommandSignal();
        await using var expiryDb = Open(gate);
        await using var approvalDb = Open(signal);
        var expire = Reservations(expiryDb).ExpirePaymentWindowAsync(review.ReservationId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var approve = Payments(approvalDb).ApproveAsync(review.PaymentId, review.Seed.AdminId);
        await AssertReviewOverlapAsync(gate, signal, expire, approve);
        Assert.True(await expire.WaitAsync(TimeSpan.FromSeconds(60)));
        var error = await Assert.ThrowsAsync<ManualPaymentReviewException>(() => approve.WaitAsync(TimeSpan.FromSeconds(60)));
        Assert.Equal(ManualPaymentReviewException.DeadlineExpired, error.Code);
        await AssertReviewAsync(review, ReservationStatus.PaymentExpired, PaymentStatus.Pending,
            ManualPaymentVerificationStatus.PendingVerification, remaining: 1);
    }

    [SqlServerWalletFact]
    public async Task ReviewProtection_OverlappingRejectionAndExpirationReleaseOnce()
    {
        var review = await PendingReviewAsync(TimeSpan.FromMinutes(10));
        var gate = new CommitGate();
        var signal = new ReviewCommandSignal();
        await using var rejectionDb = Open(gate);
        await using var expiryDb = Open(signal);
        var reject = Payments(rejectionDb).RejectAsync(review.PaymentId, new() { Reason = "Synthetic" }, review.Seed.AdminId);
        await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var expire = Reservations(expiryDb).ExpirePaymentWindowAsync(review.ReservationId);
        await AssertReviewOverlapAsync(gate, signal, reject, expire);
        await reject.WaitAsync(TimeSpan.FromSeconds(60));
        Assert.True(await expire.WaitAsync(TimeSpan.FromSeconds(60)));
        await AssertReviewAsync(review, ReservationStatus.PaymentExpired, PaymentStatus.Failed,
            ManualPaymentVerificationStatus.Rejected, remaining: 1);
    }

    private static AdminManualPaymentCreateRequest ReviewReceipt(int id) => new()
    {
        ReservationId = id, Amount = 200, Currency = "IRR", Method = ManualPaymentMethod.BankTransfer,
        // Deliberately unrelated to server submission time: this cannot grant protection.
        PaymentDate = new DateOnly(2001, 1, 1)
    };

    private async Task<PendingReview> PendingReviewAsync(TimeSpan elapsedSinceDeadline)
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        await using var setup = Open();
        var id = await setup.Reservations.Where(r => r.BookingSessionId == order).Select(r => r.Id).FirstAsync();
        var receipt = await Payments(setup).CreateAsync(ReviewReceipt(id), seed.AdminId);
        var deadline = DateTime.UtcNow.Subtract(elapsedSinceDeadline);
        // Historical timestamps are written only in this GUID-named isolated SQL fixture.
        await setup.Payments.Where(p => p.Id == receipt.PaymentId).ExecuteUpdateAsync(setters =>
            setters.SetProperty(p => p.CreatedAtUtc, deadline.AddMinutes(-1)));
        await setup.Reservations.Where(r => r.Id == id).ExecuteUpdateAsync(setters =>
            setters.SetProperty(r => r.PaymentExpiresAtUtc, deadline));
        return new(seed, order, id, receipt.PaymentId, deadline);
    }

    private async Task AssertReviewAsync(PendingReview review, ReservationStatus status, PaymentStatus paymentStatus,
        ManualPaymentVerificationStatus verification, int remaining)
    {
        await using var fresh = Open();
        var room = await fresh.Reservations.SingleAsync(r => r.Id == review.ReservationId);
        Assert.Equal(status, room.Status);
        Assert.Equal(review.Deadline, room.PaymentExpiresAtUtc);
        var payment = await fresh.Payments.Include(p => p.ManualDetails).SingleAsync(p => p.Id == review.PaymentId);
        Assert.Equal(paymentStatus, payment.Status);
        Assert.Equal(verification, payment.ManualDetails!.VerificationStatus);
        Assert.All(await fresh.Reservations.Where(r => r.BookingSessionId == review.OrderId && r.Id != review.ReservationId).ToListAsync(),
            sibling => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, sibling.Status));
        var range = await new EffectiveAvailabilityService(fresh).GetRangeAsync([review.Seed.RoomTypeId], Arrival, Arrival.AddDays(2));
        Assert.All(range[review.Seed.RoomTypeId].Nights.Values, night => Assert.Equal(remaining, night.RemainingCapacity));
        Assert.Equal(status == ReservationStatus.Confirmed ? 1 : 0,
            await fresh.ReservationVouchers.CountAsync(v => v.ReservationId == review.ReservationId));
        Assert.Equal(status == ReservationStatus.Confirmed ? 1 : 0,
            await fresh.ReservationFinancialSnapshots.CountAsync(s => s.ReservationId == review.ReservationId));
    }

    private static async Task AssertReviewOverlapAsync(CommitGate gate, ReviewCommandSignal signal, Task first, Task second)
    {
        try
        {
            await signal.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await Task.Delay(100);
            Assert.False(first.IsCompleted);
            Assert.False(second.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
    }

    private sealed record PendingReview(Seed Seed, int OrderId, int ReservationId, int PaymentId, DateTime Deadline);

    private sealed class ReviewCommandSignal : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }

    private sealed class ReviewSessionGate : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command,
            CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("BookingSessions WITH (UPDLOCK", StringComparison.OrdinalIgnoreCase))
            {
                Entered.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(45), cancellationToken);
            }
            return result;
        }
    }
}
