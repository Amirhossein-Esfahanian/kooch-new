using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyAuthorizationService
{
    Task<bool> CanAccessPropertyAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken = default);

    Task<bool> CanAccessOwnerPanelAsync(
        int userId,
        CancellationToken cancellationToken = default);

    Task<bool> HasPropertyPermissionAsync(
        int userId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken = default);

    Task<EffectivePropertyPermissions?> GetEffectivePropertyPermissionsAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<int>> GetAccessiblePropertiesAsync(
        int userId,
        CancellationToken cancellationToken = default);
}

public sealed record EffectivePropertyPermissions(
    int PropertyId,
    PropertyUserRole? PropertyRole,
    PermissionMatrixDto PermissionMatrix,
    bool IsSuperAdminBypass);
