using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertySettingService
{
    Task<IReadOnlyList<PropertySettingResponse>> GetCatalogAsync(
        bool includeInactive,
        CancellationToken cancellationToken = default);

    Task<PropertySettingResponse> CreateAsync(
        CreatePropertySettingRequest request,
        CancellationToken cancellationToken = default);

    Task<PropertySettingResponse> UpdateAsync(
        int id,
        UpdatePropertySettingRequest request,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PropertySettingAssignmentResponse>> GetPropertySettingsAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PropertySettingAssignmentResponse>> ReplacePropertySettingsAsync(
        int userId,
        UserRole role,
        int propertyId,
        SetPropertySettingsRequest request,
        CancellationToken cancellationToken = default);
}
