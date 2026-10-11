namespace Kooch.Api.Services;

public sealed class PropertyOperationalHealthService(
    IEffectiveAvailabilityService effectiveAvailabilityService) : IPropertyOperationalHealthService
{
    public async Task<bool> HasCurrentlyBookableStandardStayAsync(
        IReadOnlyList<PropertyStandardStayCandidate> configuredCandidates,
        DateOnly today,
        CancellationToken cancellationToken = default)
    {
        if (configuredCandidates.Count == 0) return false;

        var roomTypeIds = configuredCandidates.Select(candidate => candidate.RoomTypeId)
            .Distinct().ToArray();
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            roomTypeIds,
            today,
            today.AddDays(PropertyStandardStayReadinessService.ReadinessHorizonDays),
            cancellationToken: cancellationToken);

        return configuredCandidates.Any(candidate =>
            availability.TryGetValue(candidate.RoomTypeId, out var roomTypeAvailability) &&
            roomTypeAvailability.Nights.TryGetValue(candidate.Date, out var night) &&
            night.HasCapacity(1));
    }
}
