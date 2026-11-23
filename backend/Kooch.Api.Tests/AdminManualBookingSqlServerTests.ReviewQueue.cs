using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    [SqlServerWalletFact]
    public async Task ReviewQueue_FiltersPendingDirectManualReceiptsAndOrdersUrgencyBeforePagingWithoutWrites()
    {
        var (seed, ids) = await QueueFixtureAsync();
        await using var read = Open();
        var service = QueueService(read);
        var first = await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId, PageSize = 2 }, seed.AdminId);
        Assert.Equal(3, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(new[] { ids[2], ids[1] }, first.Items.Select(p => p.PaymentId));
        Assert.Equal(new[] { "ProtectionExpired", "ExpiringSoon" }, first.Items.Select(p => p.ReviewState));
        Assert.All(first.Items, row =>
        {
            Assert.NotEmpty(row.ReservationNumber); Assert.NotEmpty(row.OrderCode!);
            Assert.NotEmpty(row.GuestName); Assert.NotEmpty(row.PropertyName);
            Assert.Equal("IRR", row.Currency); Assert.Equal(200, row.Amount);
            Assert.Equal(row.PaymentExpiresAtUtc!.Value.AddHours(24), row.ReviewProtectionExpiresAtUtc);
        });
        var second = await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId, PageSize = 2, Page = 2 }, seed.AdminId);
        Assert.Equal(ids[0], Assert.Single(second.Items).PaymentId);
        Assert.Equal("Protected", second.Items[0].ReviewState);
        Assert.Equal(ids[0], Assert.Single((await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId, PageSize = 2, Page = 2 }, seed.AdminId)).Items).PaymentId);
        Assert.Empty((await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId, Page = 99 }, seed.AdminId)).Items);
        Assert.All(await read.Reservations.Where(r => r.PropertyId == seed.PropertyId).ToListAsync(), r =>
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, r.Status)); // Queue reads must not expire or release capacity.

        await using (var setup = Open())
        {
            await setup.Payments.Where(p => p.Id == ids[0]).ExecuteUpdateAsync(s => s.SetProperty(p => p.Channel, PaymentChannel.Online));
            await setup.ManualPaymentDetails.Where(p => p.PaymentId == ids[1]).ExecuteUpdateAsync(s => s.SetProperty(p => p.VerificationStatus, ManualPaymentVerificationStatus.Rejected));
            await setup.Payments.Where(p => p.Id == ids[2]).ExecuteUpdateAsync(s => s.SetProperty(p => p.IsDeleted, true));
        }
        Assert.Equal(0, (await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId }, seed.AdminId)).TotalCount);
    }

    [SqlServerWalletFact]
    public async Task ReviewQueue_TiedUrgencyUsesIdAndRetainsUnprotectedFinancialFollowUp()
    {
        var (seed, ids) = await QueueFixtureAsync();
        var deadline = DateTime.UtcNow.AddHours(2);
        await using (var setup = Open())
        {
            await setup.Payments.Where(p => ids.Contains(p.Id)).ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAtUtc, deadline.AddHours(-1)));
            await setup.Reservations.Where(r => r.PropertyId == seed.PropertyId).ExecuteUpdateAsync(s => s.SetProperty(r => r.PaymentExpiresAtUtc, deadline));
        }
        await using var read = Open();
        var service = QueueService(read);
        var page = await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId }, seed.AdminId);
        Assert.Equal(ids.Order(), page.Items.Select(p => p.PaymentId));
        await using (var setup = Open())
            await setup.Payments.Where(p => p.Id == ids[0]).ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAtUtc, deadline.AddMinutes(1)));
        page = await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId }, seed.AdminId);
        Assert.Equal(ids[0], page.Items[0].PaymentId);
        Assert.Equal("FinancialFollowUp", page.Items[0].ReviewState);
        Assert.Null(page.Items[0].ReviewProtectionExpiresAtUtc);
    }

    [SqlServerWalletFact]
    public async Task ReviewQueue_RealAuthorizationScopesTotalsAndPagesAndRejectsInaccessibleProperty()
    {
        var (visible, _) = await QueueFixtureAsync();
        var (hidden, _) = await QueueFixtureAsync();
        int actor;
        await using (var setup = Open())
        {
            var user = new User { FirstName = "Queue", LastName = "Scoped admin", Role = UserRole.AdminAssistant, IsActive = true };
            setup.Users.Add(user);
            if (!await setup.Permissions.AnyAsync(p => p.Key == PermissionKey.ManagePayments))
                setup.Permissions.Add(new() { Key = PermissionKey.ManagePayments, Name = "Synthetic manage payments" });
            await setup.SaveChangesAsync(); actor = user.Id;
            setup.UserPermissions.Add(new() { UserId = actor, PermissionKey = PermissionKey.ManagePayments, IsAllowed = true });
            setup.UserPropertyAccesses.Add(new() { UserId = actor, PropertyId = visible.PropertyId,
                PropertyRole = PropertyUserRole.Accounting, IsActive = true, Status = PropertyUserStatus.Active,
                PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto { ["Financial"] = new PermissionActionsDto { View = true } }) });
            await setup.SaveChangesAsync();
        }
        await using var read = Open();
        var service = QueueService(read);
        var page = await service.GetPendingReviewAsync(new() { PageSize = 1 }, actor);
        Assert.Equal(3, page.TotalCount); Assert.Equal(3, page.TotalPages);
        Assert.Equal(visible.PropertyId, Assert.Single(page.Items).PropertyId);
        Assert.All((await service.GetPendingReviewAsync(new(), actor)).Items, p => Assert.NotEqual(hidden.PropertyId, p.PropertyId));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetPendingReviewAsync(new() { PropertyId = hidden.PropertyId }, actor));
        await using (var setup = Open())
            await setup.UserPermissions.Where(p => p.UserId == actor).ExecuteUpdateAsync(s => s.SetProperty(p => p.IsAllowed, false));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetPendingReviewAsync(new(), actor));
        foreach (var query in new[] { new ManualPaymentReviewQueueQuery { Page = 0 }, new() { PageSize = 101 }, new() { PropertyId = 0 } })
            await Assert.ThrowsAsync<ArgumentException>(() => service.GetPendingReviewAsync(query, visible.AdminId));
    }

    [SqlServerWalletFact]
    public async Task ReviewQueue_OneHourWarningAndExistingReviewActionsUpdateTheQueue()
    {
        var (seed, ids) = await QueueFixtureAsync();
        await using (var setup = Open())
        {
            for (var i = 0; i < 2; i++)
            {
                var deadline = DateTime.UtcNow.AddHours(-23).AddMinutes(i == 0 ? 2 : -2);
                var reservationId = await setup.Payments.Where(p => p.Id == ids[i]).Select(p => p.ReservationId!.Value).SingleAsync();
                await setup.Reservations.Where(r => r.Id == reservationId).ExecuteUpdateAsync(s => s.SetProperty(r => r.PaymentExpiresAtUtc, deadline));
                await setup.Payments.Where(p => p.Id == ids[i]).ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAtUtc, deadline.AddMinutes(-1)));
            }
        }
        await using var review = Open();
        var service = QueueService(review);
        var page = await service.GetPendingReviewAsync(new() { PropertyId = seed.PropertyId }, seed.AdminId);
        Assert.Equal("Protected", page.Items.Single(p => p.PaymentId == ids[0]).ReviewState); // 62 minutes remain.
        Assert.Equal("ExpiringSoon", page.Items.Single(p => p.PaymentId == ids[1]).ReviewState); // 58 minutes remain.
        await service.ApproveAsync(ids[0], seed.AdminId);
        await service.RejectAsync(ids[1], new() { Reason = "Synthetic rejected evidence" }, seed.AdminId);
        await using var fresh = Open();
        var after = await QueueService(fresh).GetPendingReviewAsync(new() { PropertyId = seed.PropertyId }, seed.AdminId);
        Assert.Equal(1, after.TotalCount);
        Assert.Equal(ids[2], Assert.Single(after.Items).PaymentId);
    }

    private static AdminManualPaymentService QueueService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new(db, new EffectiveAvailabilityService(db), new PaymentFinancializationService(db, new CommissionPolicyResolver(db)),
            new ReservationVoucherService(db, new VoucherNumberGenerator(db)), new PermissionService(db, access), access);
    }

    private async Task<(Seed, int[])> QueueFixtureAsync()
    {
        var seed = await SeedAsync();
        var order = await ApprovedOrderAsync(seed);
        await using var setup = Open();
        var rooms = await setup.Reservations.Where(r => r.BookingSessionId == order).OrderBy(r => r.Id).Select(r => r.Id).ToListAsync();
        var ids = new List<int>();
        foreach (var room in rooms)
            ids.Add((await Payments(setup).CreateAsync(ReviewReceipt(room), seed.AdminId)).PaymentId);
        for (var i = 0; i < rooms.Count; i++)
        {
            var deadline = DateTime.UtcNow.Subtract(new[] { TimeSpan.FromMinutes(1), TimeSpan.FromHours(23.5), TimeSpan.FromHours(25) }[i]);
            await setup.Payments.Where(p => p.Id == ids[i]).ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAtUtc, deadline.AddMinutes(-1)));
            await setup.Reservations.Where(r => r.Id == rooms[i]).ExecuteUpdateAsync(s => s.SetProperty(r => r.PaymentExpiresAtUtc, deadline));
        }
        return (seed, ids.ToArray());
    }
}
