using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyCommonAreaService
{
    Task<IReadOnlyList<PropertyCommonAreaResponse>> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PropertyCommonAreaResponse>> ReplaceAsync(int userId, UserRole role, int propertyId, ReplacePropertyCommonAreasRequest request, CancellationToken cancellationToken = default);
}
