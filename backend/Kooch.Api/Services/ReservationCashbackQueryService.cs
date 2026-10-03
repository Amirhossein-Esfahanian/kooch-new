using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationCashbackQueryService(KoochDbContext dbContext)
{
    public async Task<GuestReservationCashbackResponse> GetForGuestAsync(
        int userId, string reservationNumber, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(reservationNumber))
            throw new KeyNotFoundException("Reservation not found.");

        var reservationId = await dbContext.Reservations.AsNoTracking().ForGuestUser(userId)
            .Where(row => row.ReservationNumber == reservationNumber.Trim())
            .Select(row => (int?)row.Id)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        var entitlement = await dbContext.ReservationCashbackEntitlements.AsNoTracking()
            .Include(row => row.GrantedWalletLot).ThenInclude(lot => lot!.WalletAccount)
            .Include(row => row.GrantedWalletEntry)
            .SingleOrDefaultAsync(row => row.ReservationId == reservationId && row.UserId == userId,
                cancellationToken);

        if (entitlement is null)
            return new GuestReservationCashbackResponse(null);

        DateTime? expiresAtUtc = null;
        if (entitlement.Status == CashbackEntitlementStatus.Granted)
        {
            var lot = entitlement.GrantedWalletLot;
            var entry = entitlement.GrantedWalletEntry;
            if (!entitlement.GrantedAtUtc.HasValue || !entitlement.GrantedWalletLotId.HasValue ||
                !entitlement.GrantedWalletEntryId.HasValue || lot?.ExpiresAtUtc is null || entry is null ||
                lot.WalletAccount is null || lot.WalletAccount.UserId != userId ||
                lot.WalletAccount.Currency != entitlement.Currency || lot.IsWithdrawable ||
                lot.SourceType != WalletSourceType.PromotionalCredit ||
                entry.WalletLotId != lot.Id || entry.WalletAccountId != lot.WalletAccountId ||
                entry.Direction != WalletEntryDirection.Credit || entry.Amount != entitlement.CashbackAmount)
                throw new InvalidOperationException("Granted Cashback linkage is incomplete.");
            expiresAtUtc = lot.ExpiresAtUtc;
        }

        return new GuestReservationCashbackResponse(new GuestCashbackSummaryResponse
        {
            Status = entitlement.Status,
            Amount = entitlement.CashbackAmount,
            Currency = entitlement.Currency,
            EligibleAtUtc = entitlement.EligibleAtUtc,
            GrantedAtUtc = entitlement.Status == CashbackEntitlementStatus.Granted
                ? entitlement.GrantedAtUtc : null,
            ExpiresAtUtc = expiresAtUtc
        });
    }
}
