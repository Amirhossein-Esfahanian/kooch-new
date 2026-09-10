using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminPropertyMemberDirectoryService
{
    Task<PagedResult<AdminPropertyMemberDirectoryResponse>> SearchAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyMemberDirectoryQuery query,
        CancellationToken cancellationToken = default);
}
