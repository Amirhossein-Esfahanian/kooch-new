namespace Kooch.Api.Entities;

public enum CashbackCalculationMode { Percentage = 0, FixedPerUnit = 1 }
public enum CashbackPolicySource { Global = 0, PropertyOverride = 1, PropertyDisabled = 2 }

public sealed class CashbackSetting : BaseEntity
{
    public int? PropertyId { get; set; }
    public Property? Property { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool Enabled { get; set; }
    public CashbackCalculationMode? CalculationMode { get; set; }
    public decimal? PercentageRate { get; set; }
    public decimal? SpendUnitAmount { get; set; }
    public decimal? RewardAmount { get; set; }
    public decimal? MaxCashbackPerReservation { get; set; }
    public int? ExpiryDays { get; set; }
}
