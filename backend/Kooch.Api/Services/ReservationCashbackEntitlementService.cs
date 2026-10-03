using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Wallet;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed record PendingCashbackEntitlementInput(
    int ReservationId,
    int UserId,
    int PropertyId,
    string Currency,
    decimal GuestPayableSnapshot,
    decimal NonWithdrawableWalletFundingSnapshot,
    decimal EligibleBaseSnapshot,
    decimal CashbackAmount,
    CashbackPolicySource PolicySource,
    CashbackCalculationMode CalculationMode,
    decimal? PercentageRateSnapshot,
    decimal? SpendUnitAmountSnapshot,
    decimal? RewardAmountSnapshot,
    decimal MaxCashbackPerReservationSnapshot,
    int ExpiryDaysSnapshot,
    DateTime EligibleAtUtc);

public interface IReservationCashbackEntitlementService
{
    decimal CalculateAmount(PendingCashbackEntitlementInput input);
    Task<ReservationCashbackEntitlement?> CreatePendingAsync(
        PendingCashbackEntitlementInput input, CancellationToken cancellationToken = default);
    Task<ReservationCashbackEntitlement> GrantAsync(
        int entitlementId, DateTime nowUtc, CancellationToken cancellationToken = default);
}

public sealed class ReservationCashbackEntitlementService(KoochDbContext dbContext)
    : IReservationCashbackEntitlementService
{
    public decimal CalculateAmount(PendingCashbackEntitlementInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ValidateSnapshot(input);
        return CalculateExpectedCashback(input);
    }

    public Task<ReservationCashbackEntitlement?> CreatePendingAsync(
        PendingCashbackEntitlementInput input, CancellationToken cancellationToken = default) =>
        CreatePendingCoreAsync(input, true, cancellationToken);

    internal Task<ReservationCashbackEntitlement?> StagePendingAsync(
        PendingCashbackEntitlementInput input, CancellationToken cancellationToken = default) =>
        CreatePendingCoreAsync(input, false, cancellationToken);

    internal async Task VoidPendingForReservationAsync(int reservationId,
        CancellationToken cancellationToken = default)
    {
        var entitlement = await dbContext.ReservationCashbackEntitlements
            .SingleOrDefaultAsync(row => row.ReservationId == reservationId, cancellationToken);
        if (entitlement?.Status == CashbackEntitlementStatus.Pending)
            entitlement.Status = CashbackEntitlementStatus.Voided;
    }

    public async Task<ReservationCashbackEntitlement> GrantAsync(
        int entitlementId, DateTime nowUtc, CancellationToken cancellationToken = default)
    {
        if (entitlementId <= 0 || nowUtc.Kind != DateTimeKind.Utc)
            throw new ArgumentException("A Cashback entitlement and UTC grant time are required.");
        if (!dbContext.Database.IsRelational() || dbContext.Database.CurrentTransaction is not null ||
            dbContext.ChangeTracker.HasChanges())
            throw new InvalidOperationException("Cashback Grant owns its relational transaction and requires no pending changes.");

        // Resolve only the lock key before opening the transaction; the row is
        // reloaded below under the reservation lock, so this read is never an eligibility decision.
        var reservationId = await dbContext.ReservationCashbackEntitlements.AsNoTracking()
            .Where(row => row.Id == entitlementId).Select(row => (int?)row.ReservationId)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Cashback entitlement was not found.");

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted, cancellationToken);
        try
        {
            // Cancellation takes these locks in the same order before voiding Pending Cashback.
            await BookingFundingLock.ForReservationAsync(dbContext, reservationId, cancellationToken);
            var reservationQuery = dbContext.Database.IsSqlServer()
                ? dbContext.Reservations.FromSqlInterpolated(
                    $"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
                : dbContext.Reservations.Where(row => row.Id == reservationId);
            var reservation = await reservationQuery.AsNoTracking()
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw new KeyNotFoundException("Cashback reservation was not found.");

            var entitlementQuery = dbContext.Database.IsSqlServer()
                ? dbContext.ReservationCashbackEntitlements.FromSqlInterpolated(
                    $"SELECT * FROM [ReservationCashbackEntitlements] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {entitlementId}")
                : dbContext.ReservationCashbackEntitlements.Where(row => row.Id == entitlementId);
            var entitlement = await entitlementQuery.SingleAsync(cancellationToken);
            if (entitlement.Status == CashbackEntitlementStatus.Granted)
            {
                if (!entitlement.GrantedWalletLotId.HasValue || !entitlement.GrantedWalletEntryId.HasValue ||
                    !entitlement.GrantedAtUtc.HasValue)
                    throw new InvalidOperationException("Granted Cashback linkage is incomplete.");
                await transaction.CommitAsync(cancellationToken);
                return entitlement;
            }
            if (entitlement.Status != CashbackEntitlementStatus.Pending ||
                entitlement.GrantedWalletLotId.HasValue || entitlement.GrantedWalletEntryId.HasValue ||
                entitlement.GrantedAtUtc.HasValue)
                throw new InvalidOperationException("Only an ungranted Pending Cashback entitlement can be granted.");
            if (entitlement.EligibleAtUtc > nowUtc)
                throw new InvalidOperationException("Cashback entitlement is not yet due.");
            if (reservation.Status == ReservationStatus.Cancelled)
                throw new InvalidOperationException("Cancelled reservations cannot receive Cashback.");
            if (reservation.ClientId != entitlement.UserId || reservation.PropertyId != entitlement.PropertyId ||
                reservation.Currency != entitlement.Currency)
                throw new InvalidOperationException("Cashback entitlement no longer matches its reservation.");

            var expiry = nowUtc.AddDays(entitlement.ExpiryDaysSnapshot);
            if (entitlement.CashbackAmount <= 0 || entitlement.CashbackAmount != decimal.Round(entitlement.CashbackAmount, 2) ||
                entitlement.ExpiryDaysSnapshot <= 0 || expiry <= nowUtc)
                throw new InvalidOperationException("Cashback grant snapshot is invalid.");

            var account = await WalletAccountLock.Query(dbContext, entitlement.UserId, entitlement.Currency)
                .SingleOrDefaultAsync(cancellationToken);
            if (account is null)
            {
                account = new WalletAccount { UserId = entitlement.UserId, Currency = entitlement.Currency };
                dbContext.WalletAccounts.Add(account);
            }
            var lot = new WalletLot
            {
                WalletAccount = account, SourceType = WalletSourceType.PromotionalCredit,
                IsWithdrawable = false, ExpiresAtUtc = expiry,
                SourceReference = $"cashback:entitlement:{entitlement.Id}", Reason = "Reservation Cashback"
            };
            var credit = new WalletEntry
            {
                WalletAccount = account, WalletLot = lot,
                Direction = WalletEntryDirection.Credit, Amount = entitlement.CashbackAmount
            };
            dbContext.WalletEntries.Add(credit);
            await dbContext.SaveChangesAsync(cancellationToken);

            if (lot.WalletAccountId != account.Id || account.UserId != entitlement.UserId ||
                account.Currency != entitlement.Currency || lot.IsWithdrawable ||
                credit.WalletAccountId != account.Id || credit.WalletLotId != lot.Id ||
                credit.Amount != entitlement.CashbackAmount)
                throw new InvalidOperationException("Cashback Wallet credit does not match its entitlement.");

            entitlement.GrantedWalletLotId = lot.Id;
            entitlement.GrantedWalletEntryId = credit.Id;
            entitlement.GrantedAtUtc = nowUtc;
            entitlement.Status = CashbackEntitlementStatus.Granted;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return entitlement;
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            dbContext.ChangeTracker.Clear();
            throw;
        }
    }

    private async Task<ReservationCashbackEntitlement?> CreatePendingCoreAsync(
        PendingCashbackEntitlementInput input, bool saveChanges, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        var currency = NormalizeCurrency(input.Currency);
        var expected = CalculateAmount(input);
        if (input.CashbackAmount != expected)
            throw new ArgumentException("Cashback amount does not match the immutable policy snapshot.");
        if (expected == 0) return null;

        // This checks identity only; checkout, funding and policy resolution remain with the caller.
        if (!await dbContext.Reservations.AsNoTracking().AnyAsync(reservation =>
                reservation.Id == input.ReservationId && reservation.ClientId == input.UserId &&
                reservation.PropertyId == input.PropertyId && reservation.Currency == currency,
                cancellationToken))
            throw new ArgumentException("Cashback identity does not match the reservation.");

        if (dbContext.ReservationCashbackEntitlements.Local.Any(e => e.ReservationId == input.ReservationId) ||
            await dbContext.ReservationCashbackEntitlements.AnyAsync(
                entitlement => entitlement.ReservationId == input.ReservationId, cancellationToken))
            throw new InvalidOperationException("Reservation already has a Cashback entitlement.");

        var entitlement = new ReservationCashbackEntitlement
        {
            ReservationId = input.ReservationId,
            UserId = input.UserId,
            PropertyId = input.PropertyId,
            Currency = currency,
            GuestPayableSnapshot = input.GuestPayableSnapshot,
            NonWithdrawableWalletFundingSnapshot = input.NonWithdrawableWalletFundingSnapshot,
            EligibleBaseSnapshot = input.EligibleBaseSnapshot,
            CashbackAmount = input.CashbackAmount,
            PolicySource = input.PolicySource,
            CalculationMode = input.CalculationMode,
            PercentageRateSnapshot = input.PercentageRateSnapshot,
            SpendUnitAmountSnapshot = input.SpendUnitAmountSnapshot,
            RewardAmountSnapshot = input.RewardAmountSnapshot,
            MaxCashbackPerReservationSnapshot = input.MaxCashbackPerReservationSnapshot,
            ExpiryDaysSnapshot = input.ExpiryDaysSnapshot,
            EligibleAtUtc = input.EligibleAtUtc
        };
        dbContext.ReservationCashbackEntitlements.Add(entitlement);
        if (saveChanges) await dbContext.SaveChangesAsync(cancellationToken);
        return entitlement;
    }

    private static string NormalizeCurrency(string? currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        if (normalized is null || normalized.Length != 3 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("Currency must be a three-letter code.");
        return normalized;
    }

    private static void ValidateSnapshot(PendingCashbackEntitlementInput input)
    {
        if (input.ReservationId <= 0 || input.UserId <= 0 || input.PropertyId <= 0 ||
            input.EligibleAtUtc == default || input.EligibleAtUtc.Kind != DateTimeKind.Utc)
            throw new ArgumentException("Cashback identity and UTC eligibility time are required.");
        if (!CancellationFunding.IsMoney(input.GuestPayableSnapshot) ||
            !CancellationFunding.IsMoney(input.NonWithdrawableWalletFundingSnapshot) ||
            !CancellationFunding.IsMoney(input.EligibleBaseSnapshot) ||
            !CancellationFunding.IsMoney(input.CashbackAmount) ||
            !CancellationFunding.IsMoney(input.MaxCashbackPerReservationSnapshot) ||
            input.MaxCashbackPerReservationSnapshot <= 0 || input.ExpiryDaysSnapshot <= 0 ||
            input.NonWithdrawableWalletFundingSnapshot > input.GuestPayableSnapshot ||
            input.EligibleBaseSnapshot != input.GuestPayableSnapshot - input.NonWithdrawableWalletFundingSnapshot)
            throw new ArgumentException("Cashback financial snapshot is invalid.");
        if (input.PolicySource is not (CashbackPolicySource.Global or CashbackPolicySource.PropertyOverride))
            throw new ArgumentException("Cashback policy source must be enabled.");
        switch (input.CalculationMode)
        {
            case CashbackCalculationMode.Percentage when
                input.PercentageRateSnapshot is > 0 and <= 20 &&
                input.PercentageRateSnapshot == decimal.Round(input.PercentageRateSnapshot.Value, 2) &&
                input.SpendUnitAmountSnapshot is null && input.RewardAmountSnapshot is null:
                break;
            case CashbackCalculationMode.FixedPerUnit when
                input.PercentageRateSnapshot is null &&
                input.SpendUnitAmountSnapshot is > 0 &&
                input.RewardAmountSnapshot is > 0 &&
                CancellationFunding.IsMoney(input.SpendUnitAmountSnapshot.Value) &&
                CancellationFunding.IsMoney(input.RewardAmountSnapshot.Value):
                break;
            default:
                throw new ArgumentException("Cashback policy snapshot is invalid.");
        }
    }

    private static decimal CalculateExpectedCashback(PendingCashbackEntitlementInput input)
    {
        try
        {
            var rawReward = input.CalculationMode switch
            {
                CashbackCalculationMode.Percentage => decimal.Round(
                    input.EligibleBaseSnapshot * input.PercentageRateSnapshot!.Value / 100m,
                    2, MidpointRounding.AwayFromZero),
                CashbackCalculationMode.FixedPerUnit => decimal.Round(
                    Math.Floor(input.EligibleBaseSnapshot / input.SpendUnitAmountSnapshot!.Value) *
                    input.RewardAmountSnapshot!.Value, 2, MidpointRounding.AwayFromZero),
                _ => throw new ArgumentException("Cashback calculation mode is invalid.")
            };
            return Math.Min(rawReward, input.MaxCashbackPerReservationSnapshot);
        }
        catch (OverflowException exception)
        {
            throw new ArgumentException("Cashback calculation exceeds the supported monetary range.", exception);
        }
    }
}
