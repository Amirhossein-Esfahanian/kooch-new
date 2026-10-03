using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Cashback;

public enum PropertyCashbackState { Inherit = 0, EnabledOverride = 1, Disabled = 2 }

public sealed record UpdateCashbackPolicyRequest(
    string Currency,
    bool Enabled,
    CashbackCalculationMode? CalculationMode,
    decimal? PercentageRate,
    decimal? SpendUnitAmount,
    decimal? RewardAmount,
    decimal? MaxCashbackPerReservation,
    int? ExpiryDays);

public sealed record UpdatePropertyCashbackRequest(
    string Currency,
    PropertyCashbackState State,
    CashbackCalculationMode? CalculationMode,
    decimal? PercentageRate,
    decimal? SpendUnitAmount,
    decimal? RewardAmount,
    decimal? MaxCashbackPerReservation,
    int? ExpiryDays);

public sealed record CashbackPolicyResponse(
    bool Enabled,
    CashbackPolicySource Source,
    string Currency,
    CashbackCalculationMode? CalculationMode,
    decimal? PercentageRate,
    decimal? SpendUnitAmount,
    decimal? RewardAmount,
    decimal? MaxCashbackPerReservation,
    int? ExpiryDays);

public sealed record PropertyCashbackResponse(PropertyCashbackState State, CashbackPolicyResponse EffectivePolicy);
