using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyAccessService
{
    Task<bool> CanViewAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<bool> CanManagePropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<bool> CanManageRoomsAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<bool> CanManagePricingAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
}
