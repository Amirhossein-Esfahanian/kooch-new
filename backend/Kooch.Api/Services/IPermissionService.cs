using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPermissionService
{
    Task<bool> HasPermissionAsync(
        int userId,
        PermissionKey permissionKey,
        int? propertyId = null,
        CancellationToken cancellationToken = default);
}
