using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface INearbyPlaceService
{
    Task<IReadOnlyList<NearbyPlaceResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<NearbyPlaceResponse> CreateAsync(int userId, UserRole role, int propertyId, NearbyPlaceRequest request, CancellationToken cancellationToken = default);
    Task<NearbyPlaceResponse> UpdateAsync(int userId, UserRole role, int nearbyPlaceId, NearbyPlaceRequest request, CancellationToken cancellationToken = default);
}
