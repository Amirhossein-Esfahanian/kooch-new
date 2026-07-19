using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyService
{
    Task<PropertyResponse> CreatePropertyAsync(int userId, UserRole role, CreatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdatePropertyAsync(int userId, UserRole role, int propertyId, UpdatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdatePropertyForAdminAsync(int userId, UserRole role, int propertyId, AdminUpdatePropertyRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> TransferOwnershipAsync(int userId, UserRole role, int propertyId, AdminTransferPropertyOwnershipRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateBasicSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyBasicSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateLocationSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyLocationSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateBuildingSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyBuildingSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateRulesSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyRulesSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateFinancialSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyFinancialSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateDescriptionSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertyDescriptionSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyResponse> UpdateSeoSectionAsync(int userId, UserRole role, int propertyId, UpdatePropertySeoSectionRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyResponse>> GetMyPropertiesAsync(int userId, UserRole role, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyResponse>> GetAllForAdminAsync(int userId, UserRole role, CancellationToken cancellationToken = default);
    Task<PropertyResponse> GetPropertyByIdAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PublicPropertyResponse>> GetPublicPropertiesAsync(string? q = null, string? city = null, DateOnly? checkIn = null, DateOnly? checkOut = null, int? rooms = null, int? adults = null, int? children = null, string? childAges = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PublicPropertySuggestionResponse>> GetPublicPropertySuggestionsAsync(string? q = null, string? city = null, CancellationToken cancellationToken = default);
    Task<PublicPropertyResponse?> GetPublicPropertyBySlugAsync(string slug, CancellationToken cancellationToken = default);
    Task<PropertyResponse> ApprovePropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> RejectPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> SuspendPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyResponse> SetPropertyStatusAsync(int userId, UserRole role, int propertyId, PropertyStatus status, CancellationToken cancellationToken = default);
}
