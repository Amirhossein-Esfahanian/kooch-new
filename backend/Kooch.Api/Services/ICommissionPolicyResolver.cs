using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface ICommissionPolicyResolver
{
    Task<CommissionCalculationResult> ResolveAsync(
        Reservation reservation,
        decimal grossAmount,
        CancellationToken cancellationToken = default);
}

public sealed record CommissionCalculationResult(
    CommissionType CommissionType,
    CommissionRateSource CommissionRateSource,
    decimal CommissionRate,
    decimal GrossAmount,
    decimal CommissionBase,
    decimal CommissionAmount,
    decimal PropertyPayableAmount,
    string CommissionPolicySource,
    string CommissionPolicyVersion);
