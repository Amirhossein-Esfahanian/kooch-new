using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAvailabilityService
{
    Task<IReadOnlyList<AvailabilityResponse>> GetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AvailabilityResponse>> SetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        SetAvailabilityRequest request,
        CancellationToken cancellationToken = default);
}
