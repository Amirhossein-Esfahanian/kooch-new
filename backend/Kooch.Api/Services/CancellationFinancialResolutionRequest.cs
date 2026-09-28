using Kooch.Api.Entities;

namespace Kooch.Api.Services;

// Internal domain input; authoritative payment and ledger identities are not caller-controlled.
public sealed record CancellationFinancialResolutionRequest
{
    public int ReservationId { get; init; }
    public CancellationFinancialResolutionMode Mode { get; init; }
    public decimal? GuestRefundAmount { get; init; }
    public decimal? FinalPropertyShare { get; init; }
    public decimal? FinalKoochShare { get; init; }
    public string Reason { get; init; } = string.Empty;
    public string? Note { get; init; }
    public string IdempotencyKey { get; init; } = string.Empty;
}

public enum CancellationFinancialResolutionOutcome { Finalized, AlreadyHandledByLegacyRefundV1 }

public sealed record CancellationFinancialResolutionResult(
    CancellationFinancialResolutionOutcome Outcome,
    CancellationFinancialResolution? Resolution,
    int? LegacyRefundRecordId,
    decimal OriginalPropertyShare,
    decimal OriginalKoochShare)
{
    public decimal? KoochDelta => Resolution?.FinalKoochShare - OriginalKoochShare;
}
