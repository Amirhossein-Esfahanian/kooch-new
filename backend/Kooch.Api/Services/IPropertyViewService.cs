using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyViewService
{
    Task<IReadOnlyList<PropertyViewResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyViewResponse>> ReplaceAsync(int userId, UserRole role, int propertyId, SetPropertyViewsRequest request, CancellationToken cancellationToken = default);
}
