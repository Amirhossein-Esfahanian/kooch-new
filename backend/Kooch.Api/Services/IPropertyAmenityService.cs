using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyAmenityService
{
    Task<IReadOnlyList<PropertyAmenityResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyAmenityResponse>> AddAsync(int userId, UserRole role, int propertyId, SetPropertyAmenitiesRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyAmenityResponse>> ReplaceAsync(int userId, UserRole role, int propertyId, SetPropertyAmenitiesRequest request, CancellationToken cancellationToken = default);
}
