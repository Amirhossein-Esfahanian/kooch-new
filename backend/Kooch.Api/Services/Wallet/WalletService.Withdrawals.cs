using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Wallet;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Wallet;

public sealed partial class WalletService
{
    public Task<WalletWithdrawalResponse> CreateWithdrawalAsync(int userId, string currency, decimal amount,
        CancellationToken cancellationToken = default)
    {
        if (amount <= 0 || amount > 9999999999999999.99m || amount != decimal.Round(amount, 2))
            throw new ArgumentException("Wallet withdrawal must have a positive decimal(18,2) amount.");
        return WithWalletReservationTransactionAsync(userId, currency, async (account, now) =>
        {
            var lots = await AvailableLots(userId, account.Currency, now).ToListAsync(cancellationToken);
            var ordered = lots.Where(lot => lot.IsWithdrawable && lot.Available > 0)
                .OrderBy(lot => lot.ExpiresAtUtc ?? DateTime.MaxValue)
                .ThenBy(lot => lot.CreatedAtUtc).ThenBy(lot => lot.Id).ToList();
            if (ordered.Sum(lot => lot.Available) < amount)
                throw new InvalidOperationException("Insufficient available withdrawable wallet balance.");

            var request = new WalletWithdrawalRequest
            {
                WalletAccountId = account.Id, Amount = amount,
                Status = WalletWithdrawalStatus.Pending, RequestedAtUtc = now
            };
            var remaining = amount;
            foreach (var lot in ordered)
            {
                if (remaining == 0) break;
                var allocated = Math.Min(remaining, lot.Available);
                request.Allocations.Add(new WalletWithdrawalAllocation
                {
                    WalletWithdrawalRequest = request, WalletAccountId = account.Id,
                    WalletLotId = lot.Id, Amount = allocated
                });
                remaining -= allocated;
            }
            context.WalletWithdrawalRequests.Add(request);
            await context.SaveChangesAsync(cancellationToken);
            return new WalletWithdrawalResponse(request.Id, account.Currency, request.Amount,
                request.Status, request.RequestedAtUtc);
        }, cancellationToken);
    }

    public async Task<PagedResult<WalletWithdrawalResponse>> ListWithdrawalsAsync(int userId, int page = 1,
        int pageSize = 20, CancellationToken cancellationToken = default)
    {
        if (page < 1 || pageSize is < 1 or > 100)
            throw new ArgumentException("Wallet withdrawal pagination is out of range.");
        var query = context.WalletWithdrawalRequests.AsNoTracking()
            .Where(request => request.WalletAccount.UserId == userId);
        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query.OrderByDescending(request => request.RequestedAtUtc)
            .ThenByDescending(request => request.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(request => new WalletWithdrawalResponse(request.Id, request.WalletAccount.Currency,
                request.Amount, request.Status, request.RequestedAtUtc))
            .ToListAsync(cancellationToken);
        return new PagedResult<WalletWithdrawalResponse>
        {
            Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    public async Task<PagedResult<AdminWalletWithdrawalResponse>> ListAdminWithdrawalsAsync(
        int page = 1, int pageSize = 20, WalletWithdrawalStatus? status = null,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || pageSize is < 1 or > 100 ||
            (status.HasValue && !Enum.IsDefined(status.Value)))
            throw new ArgumentException("Wallet withdrawal query is out of range.");
        var query = context.WalletWithdrawalRequests.AsNoTracking();
        if (status.HasValue) query = query.Where(request => request.Status == status.Value);
        var totalCount = await query.CountAsync(cancellationToken);
        var items = await ProjectAdminWithdrawals(query.OrderByDescending(request => request.RequestedAtUtc)
                .ThenByDescending(request => request.Id).Skip((page - 1) * pageSize).Take(pageSize))
            .ToListAsync(cancellationToken);
        return new PagedResult<AdminWalletWithdrawalResponse>
        {
            Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    public async Task<AdminWalletWithdrawalResponse> GetAdminWithdrawalAsync(int id,
        CancellationToken cancellationToken = default) =>
        await ProjectAdminWithdrawals(context.WalletWithdrawalRequests.AsNoTracking()
                .Where(request => request.Id == id)).SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Wallet withdrawal request was not found.");

    public Task<AdminWalletWithdrawalResponse> ApproveWithdrawalAsync(int id, int actorUserId,
        CancellationToken cancellationToken = default) =>
        ReviewWithdrawalAsync(id, actorUserId, WalletWithdrawalStatus.Approved, cancellationToken);

    public Task<AdminWalletWithdrawalResponse> RejectWithdrawalAsync(int id, int actorUserId,
        CancellationToken cancellationToken = default) =>
        ReviewWithdrawalAsync(id, actorUserId, WalletWithdrawalStatus.Rejected, cancellationToken);

    public async Task<AdminWalletWithdrawalResponse> PayWithdrawalAsync(int id, int actorUserId,
        MarkWalletWithdrawalPaidRequest payment, CancellationToken cancellationToken = default)
    {
        if (!payment.PayoutMethod.HasValue || !Enum.IsDefined(payment.PayoutMethod.Value))
            throw new ArgumentException("A valid withdrawal payout method is required.");
        var reference = payment.ReferenceNumber?.Trim();
        if (string.IsNullOrEmpty(reference) || reference.Length > 200)
            throw new ArgumentException("A payout reference of up to 200 characters is required.");
        if (!payment.PaidAtUtc.HasValue || payment.PaidAtUtc.Value == default)
            throw new ArgumentException("The actual payout timestamp is required.");
        if (actorUserId <= 0) throw new ArgumentException("A valid Admin actor is required.");
        var note = string.IsNullOrWhiteSpace(payment.Note) ? null : payment.Note.Trim();
        if (note?.Length > 2000) throw new ArgumentException("Payout note cannot exceed 2000 characters.");

        var owner = await context.WalletWithdrawalRequests.AsNoTracking().Where(request => request.Id == id)
            .Select(request => new { request.WalletAccountId, request.WalletAccount.UserId,
                request.WalletAccount.Currency })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Wallet withdrawal request was not found.");
        return await WithWalletReservationTransactionAsync(owner.UserId, owner.Currency, async (account, _) =>
        {
            if (account.Id != owner.WalletAccountId)
                throw new InvalidOperationException("Wallet withdrawal account changed during payout.");
            if (!await context.Users.AnyAsync(user => user.Id == actorUserId, cancellationToken))
                throw new KeyNotFoundException("Withdrawal payout actor was not found.");
            var request = await context.WalletWithdrawalRequests.SingleOrDefaultAsync(
                item => item.Id == id && item.WalletAccountId == account.Id, cancellationToken)
                ?? throw new KeyNotFoundException("Wallet withdrawal request was not found.");
            await context.Entry(request).ReloadAsync(cancellationToken);
            if (request.Status != WalletWithdrawalStatus.Approved)
                throw new InvalidOperationException("Only Approved wallet withdrawals can be paid.");
            await context.Entry(request).Collection(item => item.Allocations).LoadAsync(cancellationToken);
            if (request.Allocations.Count == 0 || request.Allocations.Sum(allocation => allocation.Amount) != request.Amount)
                throw new InvalidOperationException("Withdrawal payout requires complete original allocations.");
            foreach (var allocation in request.Allocations)
                context.WalletEntries.Add(new WalletEntry
                {
                    WalletAccountId = account.Id, WalletLotId = allocation.WalletLotId,
                    WalletWithdrawalAllocationId = allocation.Id, WalletWithdrawalAllocation = allocation,
                    Direction = WalletEntryDirection.Debit, Amount = allocation.Amount,
                    CreatedByUserId = actorUserId
                });
            request.Status = WalletWithdrawalStatus.Paid;
            request.PaidAtUtc = payment.PaidAtUtc.Value.UtcDateTime;
            request.PaidByUserId = actorUserId;
            request.PayoutMethod = payment.PayoutMethod.Value;
            request.PayoutReferenceNumber = reference;
            request.PayoutNote = note;
            request.UpdatedByUserId = actorUserId;
            await context.SaveChangesAsync(cancellationToken);
            return await GetAdminWithdrawalAsync(id, cancellationToken);
        }, cancellationToken);
    }

    private async Task<AdminWalletWithdrawalResponse> ReviewWithdrawalAsync(int id, int actorUserId,
        WalletWithdrawalStatus targetStatus, CancellationToken cancellationToken)
    {
        var owner = await context.WalletWithdrawalRequests.AsNoTracking()
            .Where(request => request.Id == id)
            .Select(request => new { request.WalletAccountId, request.WalletAccount.UserId,
                request.WalletAccount.Currency })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Wallet withdrawal request was not found.");
        return await WithWalletReservationTransactionAsync(owner.UserId, owner.Currency, async (account, _) =>
        {
            if (account.Id != owner.WalletAccountId)
                throw new InvalidOperationException("Wallet withdrawal account changed during review.");
            if (!await context.Users.AnyAsync(user => user.Id == actorUserId, cancellationToken))
                throw new KeyNotFoundException("Withdrawal reviewer was not found.");
            var request = await context.WalletWithdrawalRequests.SingleOrDefaultAsync(
                item => item.Id == id && item.WalletAccountId == account.Id, cancellationToken)
                ?? throw new KeyNotFoundException("Wallet withdrawal request was not found.");
            // A scoped context may have tracked Pending before another reviewer committed.
            await context.Entry(request).ReloadAsync(cancellationToken);
            if (request.Status != WalletWithdrawalStatus.Pending)
                throw new InvalidOperationException("Only Pending wallet withdrawals can be reviewed.");
            request.Status = targetStatus;
            request.UpdatedByUserId = actorUserId;
            await context.SaveChangesAsync(cancellationToken);
            return await GetAdminWithdrawalAsync(id, cancellationToken);
        }, cancellationToken);
    }

    private static IQueryable<AdminWalletWithdrawalResponse> ProjectAdminWithdrawals(
        IQueryable<WalletWithdrawalRequest> requests) =>
        requests.Select(request => new AdminWalletWithdrawalResponse(
            request.Id,
            request.WalletAccount.User.FirstName + " " + request.WalletAccount.User.LastName,
            request.WalletAccount.Currency, request.Amount, request.Status, request.RequestedAtUtc,
            request.Status == WalletWithdrawalStatus.Pending ? null : request.UpdatedAtUtc,
            request.PaidAtUtc, request.PayoutMethod, request.PayoutReferenceNumber, request.PayoutNote));
}
