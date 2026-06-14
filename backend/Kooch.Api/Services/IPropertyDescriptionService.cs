using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyDescriptionService
{
    Task<IReadOnlyList<PropertyDescriptionSectionResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyDescriptionSectionResponse> CreateAsync(int userId, UserRole role, int propertyId, PropertyDescriptionSectionRequest request, CancellationToken cancellationToken = default);
    Task<PropertyDescriptionSectionResponse> UpdateAsync(int userId, UserRole role, int descriptionId, PropertyDescriptionSectionRequest request, CancellationToken cancellationToken = default);
}
