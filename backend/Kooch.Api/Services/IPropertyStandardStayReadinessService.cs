namespace Kooch.Api.Services;

public interface IPropertyStandardStayReadinessService
{
    Task<PropertyStandardStayReadiness> EvaluateAsync(
        int propertyId,
        DateOnly today,
        CancellationToken cancellationToken = default);
}

public sealed record PropertyStandardStayReadiness(
    bool HasValidDailyPricing,
    bool HasValidConfiguredAvailability,
    bool HasJointStandardStay)
{
    public IReadOnlyList<PropertyStandardStayCandidate> ConfiguredCandidates { get; init; } = [];
}

public sealed record PropertyStandardStayCandidate(int RoomTypeId, DateOnly Date);
