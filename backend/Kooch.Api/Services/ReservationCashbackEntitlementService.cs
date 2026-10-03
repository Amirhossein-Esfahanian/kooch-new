using Kooch.Api.Data;
using Kooch.Api.Entities;
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
    Task<ReservationCashbackEntitlement?> CreatePendingAsync(
        PendingCashbackEntitlementInput input, CancellationToken cancellationToken = default);
}

public sealed class ReservationCashbackEntitlementService(KoochDbContext dbContext)
    : IReservationCashbackEntitlementService
{
    public async Task<ReservationCashbackEntitlement?> CreatePendingAsync(
        PendingCashbackEntitlementInput input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var currency = NormalizeCurrency(input.Currency);
        ValidateSnapshot(input);
        var expected = CalculateExpectedCashback(input);
        if (input.CashbackAmount != expected)
            throw new ArgumentException("Cashback amount does not match the immutable policy snapshot.");
        if (expected == 0) return null;

        // This checks identity only; checkout, funding and policy resolution remain with the caller.
        if (!await dbContext.Reservations.AsNoTracking().AnyAsync(reservation =>
                reservation.Id == input.ReservationId && reservation.ClientId == input.UserId &&
                reservation.PropertyId == input.PropertyId && reservation.Currency == currency,
                cancellationToken))
            throw new ArgumentException("Cashback identity does not match the reservation.");

        if (await dbContext.ReservationCashbackEntitlements.AnyAsync(
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
        await dbContext.SaveChangesAsync(cancellationToken);
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
