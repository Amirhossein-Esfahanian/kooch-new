using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyService
{
    Task<PropertyResponse> CreatePropertyAsync(int userId, UserRole role, CreatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdatePropertyAsync(int userId, UserRole role, int propertyId, UpdatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdatePropertyForAdminAsync(int userId, UserRole role, int propertyId, AdminUpdatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyResponse>> GetMyPropertiesAsync(int userId, UserRole role, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyResponse>> GetAllForAdminAsync(int userId, UserRole role, CancellationToken cancellationToken = default);
    Task<PropertyResponse> GetPropertyByIdAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PublicPropertyResponse>> GetPublicPropertiesAsync(CancellationToken cancellationToken = default);
    Task<PublicPropertyResponse?> GetPublicPropertyBySlugAsync(string slug, CancellationToken cancellationToken = default);
    Task<PropertyResponse> ApprovePropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> RejectPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> SuspendPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> SetPropertyStatusAsync(int userId, UserRole role, int propertyId, PropertyStatus status, CancellationToken cancellationToken = default);
}
