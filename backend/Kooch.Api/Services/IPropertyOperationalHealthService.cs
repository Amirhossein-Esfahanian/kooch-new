namespace Kooch.Api.Services;

public interface IPropertyOperationalHealthService
{
    Task<bool> HasCurrentlyBookableStandardStayAsync(
        IReadOnlyList<PropertyStandardStayCandidate> configuredCandidates,
        DateOnly today,
        CancellationToken cancellationToken = default);
}
