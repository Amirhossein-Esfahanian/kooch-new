namespace Kooch.Api.Entities;

public enum CashbackEntitlementStatus { Pending = 0, Granted = 1, Voided = 2 }

public sealed class ReservationCashbackEntitlement : BaseEntity
{
    public int ReservationId { get; set; }
    public int UserId { get; set; }
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public CashbackEntitlementStatus Status { get; set; } = CashbackEntitlementStatus.Pending;

    public decimal GuestPayableSnapshot { get; set; }
    public decimal NonWithdrawableWalletFundingSnapshot { get; set; }
    public decimal EligibleBaseSnapshot { get; set; }
    public decimal CashbackAmount { get; set; }

    public CashbackPolicySource PolicySource { get; set; }
    public CashbackCalculationMode CalculationMode { get; set; }
    public decimal? PercentageRateSnapshot { get; set; }
    public decimal? SpendUnitAmountSnapshot { get; set; }
    public decimal? RewardAmountSnapshot { get; set; }
    public decimal MaxCashbackPerReservationSnapshot { get; set; }
    public int ExpiryDaysSnapshot { get; set; }
    public DateTime EligibleAtUtc { get; set; }

    public int? GrantedWalletLotId { get; set; }
    public int? GrantedWalletEntryId { get; set; }
    public DateTime? GrantedAtUtc { get; set; }

    public Reservation Reservation { get; set; } = null!;
    public User User { get; set; } = null!;
    public Property Property { get; set; } = null!;
    public WalletLot? GrantedWalletLot { get; set; }
    public WalletEntry? GrantedWalletEntry { get; set; }
}
