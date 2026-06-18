using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyImageService
{
    Task<IReadOnlyList<PropertyImageResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyImageResponse> CreateAsync(int userId, UserRole role, int propertyId, PropertyImageRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyImageResponse>> UploadAsync(int userId, UserRole role, int propertyId, PropertyImageUploadRequest request, CancellationToken cancellationToken = default);
    Task<PropertyImageResponse> UpdateAsync(int userId, UserRole role, int imageId, PropertyImageRequest request, CancellationToken cancellationToken = default);
    Task DeleteAsync(int userId, UserRole role, int imageId, CancellationToken cancellationToken = default);
}
